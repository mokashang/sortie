import { DB, logEvent } from "@/lib/db";
import { hasLiveOrQueuedRun, lastRunChannel, startExecutor, ExecutorChannel, StartOptions } from "@/executor/runner";
import { manualItem, parkWithItems } from "@/apply/queue";

// What a resolved 待处理 card turns into (2026-09-17). The user answered / uploaded / logged in /
// clicked 「让助手再试一次」, so the job must be filled next — and "next" has to mean something even
// while the assistant is busy. Before this, the card's route called maybeAutoStartApply, which
// stands down whenever any apply run is live or queued ("the next run takes them"); the row went
// back to 'matched' in the general pool and nothing ever singled it out again. Ciena (job 112985)
// and Tebra (157799) vanished that way on 2026-09-14/15: answered while another run was on, never
// filled. Now a resolved card is a targeted run — merged into a queued targeted run of the same
// mode if there is one, otherwise queued *behind* whatever is running (runner.ts queueBehind).
// The attended session works its queue in id order and claims the next run when it finishes, so
// the job is filled a few seconds after the current run ends, and the task shows on the assistant
// card in the meantime ("排队中 · 直接投 · #112985").

export interface FollowupDeps {
  hasLiveOrQueuedRun?: typeof hasLiveOrQueuedRun;
  lastRunChannel?: typeof lastRunChannel;
  startExecutor?: typeof startExecutor;
  logDir?: string;
}

export interface FollowupResult {
  autoStarted: boolean;
  runId?: number;
  channel?: ExecutorChannel;
  // The jobs were added to a targeted run that was already queued (no new run).
  merged?: boolean;
}

function cleanIds(jobIds: number[]): number[] {
  return Array.from(new Set(jobIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)));
}

// Queue a run scoped to `jobIds` in `mode`. Never throws: the caller's own state change (the
// answers are stored, the login wall is cleared) already succeeded and must not be undone by a
// scheduling failure — the App still shows the row, and the user can retry from the card.
export function queueTargetedRun(
  db: DB,
  userId: string,
  jobIds: number[],
  mode: "direct" | "referral" = "direct",
  deps: FollowupDeps = {}
): FollowupResult {
  const ids = cleanIds(jobIds);
  if (ids.length === 0) return { autoStarted: false };
  const checkLive = deps.hasLiveOrQueuedRun ?? hasLiveOrQueuedRun;
  const getLastChannel = deps.lastRunChannel ?? lastRunChannel;
  const start = deps.startExecutor ?? startExecutor;
  const runnerDeps = deps.logDir ? { logDir: deps.logDir } : {};
  try {
    const channel: ExecutorChannel = getLastChannel(db, userId, "apply") === "headless" ? "headless" : "user_chrome";
    if (channel === "headless") {
      // A headless run is a process spawned right now; nothing can wait behind one. Same
      // stand-down as before on this channel (not the App's default).
      if (checkLive(db, userId, "apply")) return { autoStarted: false };
      const started = start(db, userId, "apply", { jobIds: ids, mode }, runnerDeps, "headless");
      return { autoStarted: true, runId: started.id, channel };
    }
    const queued = db
      .prepare("SELECT id, options FROM executor_runs WHERE user_id = ? AND kind = 'apply' AND channel = 'user_chrome' AND status = 'queued' ORDER BY id ASC")
      .all(userId) as { id: number; options: string }[];
    for (const row of queued) {
      let o: StartOptions = {};
      try {
        o = JSON.parse(row.options);
      } catch {
        continue;
      }
      const targeted = Array.isArray(o.jobIds) && o.jobIds.length > 0 && !(Array.isArray(o.plan) && o.plan.length > 0);
      if (!targeted || (o.mode ?? "direct") !== mode) continue;
      const merged = cleanIds([...(o.jobIds as number[]), ...ids]);
      db.prepare("UPDATE executor_runs SET options = ? WHERE id = ? AND status = 'queued'").run(JSON.stringify({ ...o, jobIds: merged }), row.id);
      logEvent(db, "apply_followup_merged", { userId, entity: "run", entityId: row.id, payload: { jobIds: ids, mode } });
      return { autoStarted: true, runId: row.id, channel, merged: true };
    }
    const started = start(db, userId, "apply", { jobIds: ids, mode }, { ...runnerDeps, queueBehind: true }, "user_chrome");
    logEvent(db, "apply_followup_queued", { userId, entity: "run", entityId: started.id, payload: { jobIds: ids, mode } });
    return { autoStarted: true, runId: started.id, channel };
  } catch (e) {
    console.error("[apply followup] could not queue", ids, e);
    return { autoStarted: false };
  }
}

// Is the run that took this application still running? Only then can its session act on an
// answer in place (the tab is that session's own): answerInfo keeps the row 'prepared' for it.
// Any other case — the run ended, was reaped, or the row was never taken — means nobody is on
// the form, whatever other run of the account happens to be alive. (Before 2026-09-17 the check
// was "any apply run of the account is running": Commure (1747881) and Neighbor (620336) were
// answered on 2026-09-14 while an unrelated targeted run was on, flipped to 'prepared' for a
// session that had died hours earlier, and sat invisible for three days.)
export function askingRunAlive(db: DB, userId: string, jobId: number): boolean {
  const row = db
    .prepare(
      `SELECT r.status FROM applications a JOIN executor_runs r ON r.id = a.run_id
       WHERE a.user_id = ? AND a.job_id = ? AND r.kind = 'apply'`
    )
    .get(userId, jobId) as { status: string } | undefined;
  return row?.status === "running";
}

export interface ReclaimResult {
  // Rows put back to 'matched' (taken by a run that is over, never reported).
  reclaimed: number[];
  // Of those, the ones the user had answered questions for: queued as a targeted run.
  requeued: number[];
  // Answered rows a targeted run had already been given and still did not finish: a card, not
  // another silent retry.
  parked: number[];
  followup: FollowupResult | null;
}

// Rows at 'prepared' whose run is over (or that never had one, 30 minutes on) were taken and never reported —
// the session crashed, skipped them without saying, or the row was flipped to 'prepared' for a
// run that no longer existed. Left alone they are invisible: not a card, not in the queue, not
// in any run's plan (takeNextApplication reclaims them after 30 minutes, but only when something
// asks it for a job). Run from the dispatcher tick and at every run's end: back to 'matched',
// and the ones carrying the user's answers become a targeted run — once. If the run that dropped
// them was already targeted at them, they become a card instead (让助手再试一次), so no loop.
export function reclaimStrandedPrepared(db: DB, userId: string, deps: FollowupDeps = {}): ReclaimResult {
  const result: ReclaimResult = { reclaimed: [], requeued: [], parked: [], followup: null };
  try {
    const rows = db
      .prepare(
        `SELECT a.job_id, a.run_id, a.info_answers, r.status AS run_status, r.options AS run_options
         FROM applications a LEFT JOIN executor_runs r ON r.id = a.run_id
         WHERE a.user_id = ? AND a.status = 'prepared'
           AND ((a.run_id IS NULL AND a.updated_at < datetime('now', '-30 minutes'))
             OR (a.run_id IS NOT NULL AND (r.id IS NULL OR r.status NOT IN ('running','queued','paused'))))`
      )
      .all(userId) as { job_id: number; run_id: number | null; info_answers: string | null; run_status: string | null; run_options: string | null }[];
    if (rows.length === 0) return result;
    const toRequeue: number[] = [];
    db.transaction(() => {
      for (const r of rows) {
        db.prepare("UPDATE applications SET status = 'matched' WHERE user_id = ? AND job_id = ? AND status = 'prepared'").run(userId, r.job_id);
        result.reclaimed.push(r.job_id);
        if (!r.info_answers) continue;
        let targetedAtIt = false;
        try {
          const o = r.run_options ? (JSON.parse(r.run_options) as StartOptions) : {};
          targetedAtIt = Array.isArray(o.jobIds) && o.jobIds.map(Number).includes(r.job_id);
        } catch {
          targetedAtIt = false;
        }
        if (targetedAtIt) {
          parkWithItems(
            db,
            userId,
            r.job_id,
            [manualItem("error", "助手没填完这份申请", `任务 #${r.run_id} 拿到了这个岗但没有回报结果。`)],
            `error: run #${r.run_id} took the job and never reported`
          );
          result.parked.push(r.job_id);
        } else {
          toRequeue.push(r.job_id);
        }
      }
    })();
    logEvent(db, "application_reclaimed", { userId, payload: { reclaimed: result.reclaimed, requeued: toRequeue, parked: result.parked } });
    if (toRequeue.length > 0) {
      result.followup = queueTargetedRun(db, userId, toRequeue, "direct", deps);
      if (result.followup.autoStarted) result.requeued = toRequeue;
    }
  } catch (e) {
    console.error("[apply followup] reclaim failed", e);
  }
  return result;
}
