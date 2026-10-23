import { DB, logEvent } from "@/lib/db";
import { listSpawns, ownerOf, SpawnRecord } from "@/executor/sessions";
import { isAttendedReachable, writeToAttended, NOTICE_PREFIX, CARRY_ON } from "@/executor/attended-session";
// queue.ts's SUBMIT_BLOCKED_PREFIX, spelled out here so this module (loaded by attended.ts) does not
// pull the whole apply queue in at import time; tests/attended-tabs.test.ts keeps the two equal.
export const SUBMIT_BLOCKED_REASON_PREFIX = "submit blocked: ";

// How many Chrome tabs the attended sessions may hold open, and for how long (user, 2026-10-22:
// "很多标签页如果卡住的话,卡到一定时间就关掉,不要占空间,最高不要同时超过30个标签页同时开着").
// Until then a session kept every form it filled open until the user acted on it, and never
// closed a tab at all (closing a group's *last* tab makes Chrome drop the whole group — the
// 2026-09-17 Lumion loss — so the rule became "never close"). With a dozen-plus open forms
// Chrome started discarding them (run 606: tab ids changed, renderers froze), so the forms were
// lost anyway, just silently.
//
// Now each session keeps one blank anchor tab (so its group never empties) and closes every other
// tab once its job is done. The App counts the tabs it knows a session holds for a job — a filled
// form waiting for approval or submission, a form waiting for the user's answers, a form handed
// back answers to fill — and tells the owning session to close any that has been stuck for
// STUCK_TAB_MS, and the oldest ones whenever the total would pass MAX_OPEN_TABS. A closed tab's
// job is detached from the session (applications.run_id = NULL), which every downstream path
// already reads as "nobody holds this form": an answered card becomes a fresh targeted fill, an
// approved fill becomes a resume run that fills it again, a 'prepared' row goes back to the queue.

export const MAX_OPEN_TABS = 30;
export const STUCK_TAB_MS = 60 * 60 * 1000;

export interface HeldTab {
  jobId: number;
  pid: number;
  startedAt: string; // the owning session's SpawnRecord.startedAt
  runId: number;
  status: string;
  since: string; // applications.updated_at (UTC, SQLite form): the last change to the row
}

export interface TabRelease extends HeldTab {
  why: "stuck" | "cap";
}

function ts(at: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : at.replace(" ", "T") + "Z");
}

// needs_info keeps the tab only for questions answered in place (text / file / action); a login or
// manual item parks the job and the session closes its tab at once.
function keepsTab(status: string, pendingQuestions: string | null): boolean {
  if (status !== "needs_info") return true;
  try {
    const items = JSON.parse(pendingQuestions || "[]") as { kind?: string }[];
    return items.some((q) => !q.kind || q.kind === "text" || q.kind === "file" || q.kind === "action");
  } catch {
    return true;
  }
}

// SQL (alias a = applications): a row whose tab its session keeps open for the user — the three
// waiting states, plus a refused Submit parked as a 「点提交」 card (status 'matched' with the
// submit-blocked reason, src/apply/submit-blocked.ts), whose form stays filled in the tab for the
// user to click.
export const TAB_HOLDING_SQL = `(a.status IN ('awaiting_confirm','needs_info','prepared') OR (a.status = 'matched' AND a.needs_manual_reason LIKE '${SUBMIT_BLOCKED_REASON_PREFIX}%'))`;

// The tabs live sessions hold for jobs, oldest first.
export function heldTabs(db: DB, userId: string, spawns: SpawnRecord[] = listSpawns(db)): HeldTab[] {
  const rows = db
    .prepare(
      `SELECT a.job_id, a.status, a.updated_at, a.pending_questions, a.run_id, r.pid, r.claimed_at, r.channel
       FROM applications a JOIN executor_runs r ON r.id = a.run_id
       WHERE a.user_id = ? AND ${TAB_HOLDING_SQL} AND r.channel = 'user_chrome'
       ORDER BY a.updated_at ASC, a.job_id ASC`
    )
    .all(userId) as {
    job_id: number;
    status: string;
    updated_at: string;
    pending_questions: string | null;
    run_id: number;
    pid: number | null;
    claimed_at: string | null;
    channel: string;
  }[];
  const out: HeldTab[] = [];
  for (const r of rows) {
    if (!keepsTab(r.status, r.pending_questions)) continue;
    const owner = ownerOf(r, spawns);
    if (!owner) continue;
    out.push({ jobId: r.job_id, pid: owner.pid, startedAt: owner.startedAt, runId: r.run_id, status: r.status, since: r.updated_at });
  }
  return out;
}

// Pure (tests/attended-tabs.test.ts): which tabs to close now. Every tab stuck past stuckMs, then
// the oldest of the rest while the total — those tabs plus one anchor per session — is over cap.
export function planTabReleases(held: HeldTab[], sessions: number, now: number, opts: { cap?: number; stuckMs?: number } = {}): TabRelease[] {
  const cap = opts.cap ?? MAX_OPEN_TABS;
  const stuckMs = opts.stuckMs ?? STUCK_TAB_MS;
  // A 'prepared' tab is being filled with the user's answers right now: it counts, but is never
  // closed here (reclaimStrandedPrepared takes back one nobody fills within 30 minutes).
  const sorted = [...held].sort((a, b) => ts(a.since) - ts(b.since) || a.jobId - b.jobId);
  const closable = sorted.filter((t) => t.status !== "prepared");
  const stuck = closable.filter((t) => now - ts(t.since) >= stuckMs);
  const rest = closable.filter((t) => now - ts(t.since) < stuckMs);
  const over = Math.max(0, held.length - stuck.length + sessions - cap);
  return [...stuck.map((t) => ({ ...t, why: "stuck" as const })), ...rest.slice(0, over).map((t) => ({ ...t, why: "cap" as const }))];
}

export function closeTabNotice(jobId: number, why: TabRelease["why"]): string {
  const reason = why === "stuck" ? "it has been waiting for over an hour" : `more than ${MAX_OPEN_TABS} tabs are open`;
  return `${NOTICE_PREFIX} close job ${jobId}: ${reason}. Find the tab you opened for job ${jobId} and close it with tabs_close_mcp (if it is the last tab left in your group, navigate it to about:blank instead). Do not submit or report anything for it - the App has already taken it back and will have it filled again when it is needed. ${CARRY_ON}`;
}

export interface TabSweepResult {
  open: number;
  released: { jobId: number; pid: number; why: TabRelease["why"] }[];
}

// The dispatcher tick: tell each owner to close its stuck / over-cap tabs, and detach those jobs
// from the session so nothing waits on a tab that is gone. A session this process can't type to
// is left alone (the dispatcher reaps it when there is work for it). Never throws.
export function sweepTabs(
  db: DB,
  userId: string,
  deps: { now?: number; spawns?: SpawnRecord[]; reachable?: (pid: number) => boolean; write?: (pid: number, line: string) => boolean; cap?: number; stuckMs?: number } = {}
): TabSweepResult {
  const result: TabSweepResult = { open: 0, released: [] };
  try {
    const spawns = deps.spawns ?? listSpawns(db);
    if (spawns.length === 0) return result;
    const held = heldTabs(db, userId, spawns);
    result.open = held.length + spawns.length;
    const reachable = deps.reachable ?? isAttendedReachable;
    const write = deps.write ?? writeToAttended;
    const plan = planTabReleases(held, spawns.length, deps.now ?? Date.now(), { cap: deps.cap, stuckMs: deps.stuckMs });
    for (const t of plan) {
      if (!reachable(t.pid)) continue;
      const detached = db.prepare("UPDATE applications SET run_id = NULL WHERE user_id = ? AND job_id = ? AND run_id = ?").run(userId, t.jobId, t.runId).changes;
      if (detached === 0) continue;
      write(t.pid, closeTabNotice(t.jobId, t.why));
      result.released.push({ jobId: t.jobId, pid: t.pid, why: t.why });
    }
    if (result.released.length > 0) logEvent(db, "attended_tabs_released", { userId, payload: { open: result.open, released: result.released } });
  } catch (e) {
    console.error("[attended tabs] sweep failed", e);
  }
  return result;
}
