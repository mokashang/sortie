import fs from "fs";
import path from "path";
import { DB } from "@/lib/db";
import type { ChainInfo, ModeCounts } from "@/app/lib/run-outcome";
import { APPLY_CHUNK_SIZE, BACKLOG_PAUSE_AT, BACKLOG_RESUME_AT } from "@/app/lib/run-outcome";
import { rowResult, plannedCounts, ClaimedRow } from "@/apply/run-outcome";
import { startExecutor, hasLiveOrQueuedRun, ExecutorChannel, StartOptions } from "@/executor/runner";

export { APPLY_CHUNK_SIZE, BACKLOG_PAUSE_AT, BACKLOG_RESUME_AT };

// 接力(2026-09-13,用户定的):一个助手会话撑不了 70 份——任务 #68 计划海投 70,会话一开始就写下「不可能
// 在一个任务里做完」,填到第 11 个就收工。所以计划再大,一个 run 也只做一段(options.chunk,默认 10 份);
// 收工时服务器按 applications.run_id 算出各条目还剩多少,自动排下一段(options.chain 记 root / 第几段 /
// 累计,并带 resume:true 先补提交已批准的),直到达标、没货、或连续两段零进展;用户点停止就断链。
// 填好的申请每份占一个 Chrome 标签页等用户确认,未确认的积压到 BACKLOG_PAUSE_AT 份时下一段先以
// status='paused' 挂着(界面「已暂停」),用户确认/退回到 BACKLOG_RESUME_AT 份以下自动转 queued。
// 一条链属于一个账号(executor_runs.user_id):积压、暂停、接续都只看该账号自己的行。

export const MAX_CHAIN_STEPS = 30; // safety valve: 30 segments × 10 = far beyond any real plan
export const MAX_ZERO_PROGRESS_RUNS = 2; // two consecutive segments with nothing to show → stop

export interface PlanEntryLike {
  direction: string;
  count: number;
  mode?: string;
}

export interface ContinueDeps {
  startExecutor?: typeof startExecutor;
  hasLiveOrQueuedRun?: typeof hasLiveOrQueuedRun;
  // Where a resumed user_chrome segment's log file goes (tests point this at a temp dir).
  logDir?: string;
  // The run did not finish: its attended session was reaped mid-segment (server restart, child
  // crash — src/executor/attended.ts closeOutReapedSession). The plan still continues; only a
  // run the user stopped, or one the session itself reported as failed, ends the chain.
  interrupted?: boolean;
}

export type ContinueResult =
  | { action: "none"; reason: string }
  | { action: "queued"; runId: number; channel: ExecutorChannel }
  | { action: "paused"; runId: number; unconfirmed: number };

// Filled applications the account has not decided on yet — each one is an open Chrome tab
// waiting for a click on /apply. Approving or rejecting shrinks it; submitting does not change it.
export function unconfirmedCount(db: DB, userId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) n FROM applications WHERE user_id = ? AND status = 'awaiting_confirm' AND confirm_decision IS NULL")
      .get(userId) as { n: number }
  ).n;
}

interface ClaimedWithDirection extends ClaimedRow {
  direction: string | null;
}

// What is left of `plan` after run `runId`: each entry minus what the run achieved for that
// direction+mode. An entry the run claimed jobs for but achieved nothing on is dropped — the
// direction is exhausted, or blocked (LinkedIn's monthly invite quota, every page a dead link) —
// so the next segment does not burn its time on it again; an entry the run never reached is
// kept in full.
export function remainingPlan(
  db: DB,
  runId: number,
  plan: PlanEntryLike[]
): { remaining: PlanEntryLike[]; dropped: PlanEntryLike[]; own: ModeCounts } {
  const rows = db
    .prepare(
      `SELECT m.direction, a.status, a.confirm_decision, a.needs_manual_reason, a.pending_questions
       FROM applications a LEFT JOIN matches m ON m.user_id = a.user_id AND m.job_id = a.job_id WHERE a.run_id = ?`
    )
    .all(runId) as ClaimedWithDirection[];
  const results = rows.map((r) => ({ direction: r.direction, ...rowResult(r) }));
  const own = { direct: 0, referral: 0 };
  for (const r of results) if (r.achieved) own[r.mode] += 1;

  const remaining: PlanEntryLike[] = [];
  const dropped: PlanEntryLike[] = [];
  for (const e of plan) {
    const mode = e.mode === "referral" ? "referral" : "direct";
    const mine = results.filter((r) => r.direction === e.direction && r.mode === mode);
    const achieved = mine.filter((r) => r.achieved).length;
    const left = Math.max(0, Math.floor(Number(e.count) || 0)) - achieved;
    if (left <= 0) continue;
    if (mine.length > 0 && achieved === 0) {
      dropped.push({ direction: e.direction, count: left, mode });
      continue;
    }
    remaining.push({ direction: e.direction, count: left, mode });
  }
  return { remaining, dropped, own };
}

function chainOf(options: { chain?: ChainInfo }, runId: number): ChainInfo {
  return (
    options.chain ?? {
      root: runId,
      step: 1,
      planned: plannedCounts(options) ?? { direct: 0, referral: 0 },
      before: { direct: 0, referral: 0 },
      zeroRuns: 0,
    }
  );
}

function insertPausedRun(db: DB, userId: string, channel: ExecutorChannel, options: StartOptions, unconfirmed: number, live = false): number {
  const summary =
    unconfirmed >= BACKLOG_PAUSE_AT
      ? `等待确认:${unconfirmed} 份填好的申请还没确认,降到 ${BACKLOG_RESUME_AT} 份以下自动继续`
      : live
        ? "等排在前面的任务做完再继续"
        : `等待确认:${unconfirmed} 份填好的申请还没确认,降到 ${BACKLOG_RESUME_AT} 份以下自动继续`;
  const r = db
    .prepare("INSERT INTO executor_runs (user_id, kind, status, channel, pid, options, summary) VALUES (?, 'apply', 'paused', ?, NULL, ?, ?)")
    .run(userId, channel, JSON.stringify(options), summary);
  return Number(r.lastInsertRowid);
}

// Called once an apply run has reached 'done' (finish route; headless exit handler). Decides
// whether the plan needs another segment and either queues it, parks it as 'paused' behind the
// confirmation backlog, or ends the chain. The account is the run's own. Never throws — a
// bookkeeping failure must not turn a successful finish into an error.
export function maybeContinueApplyRun(db: DB, runId: number, deps: ContinueDeps = {}): ContinueResult {
  try {
    const run = db.prepare("SELECT user_id, kind, status, channel, options FROM executor_runs WHERE id = ?").get(runId) as
      | { user_id: string; kind: string; status: string; channel: string; options: string }
      | undefined;
    if (!run || run.kind !== "apply") return { action: "none", reason: "not an apply run" };
    if (run.status !== "done" && !(deps.interrupted && run.status === "failed"))
      return { action: "none", reason: `run ended as ${run.status}, chain stops` };
    const userId = run.user_id;
    let options: StartOptions & { chain?: ChainInfo } = {};
    try {
      options = JSON.parse(run.options);
    } catch {
      options = {};
    }
    const plan = Array.isArray(options.plan) ? (options.plan as PlanEntryLike[]) : [];
    if (plan.length === 0) return { action: "none", reason: "no plan to continue" };

    const chain = chainOf(options, runId);
    const { remaining, own } = remainingPlan(db, runId, plan);
    const zeroRuns = own.direct + own.referral === 0 ? chain.zeroRuns + 1 : 0;
    if (remaining.length === 0) return { action: "none", reason: "plan finished (or nothing left worth retrying)" };
    if (zeroRuns >= MAX_ZERO_PROGRESS_RUNS) return { action: "none", reason: `no progress in ${zeroRuns} consecutive segments` };
    if (chain.step >= MAX_CHAIN_STEPS) return { action: "none", reason: `chain already ${chain.step} segments long` };

    const next: StartOptions = {
      resume: true, // submit whatever the user approved meanwhile before filling new ones
      plan: remaining.map((e) => ({ direction: e.direction, count: e.count, mode: e.mode === "referral" ? "referral" : "direct" })),
      chunk: typeof options.chunk === "number" && options.chunk > 0 ? options.chunk : APPLY_CHUNK_SIZE,
      chain: {
        root: chain.root,
        step: chain.step + 1,
        planned: chain.planned,
        before: { direct: chain.before.direct + own.direct, referral: chain.before.referral + own.referral },
        zeroRuns,
      },
    };
    const channel = (run.channel === "headless" ? "headless" : "user_chrome") as ExecutorChannel;
    const unconfirmed = unconfirmedCount(db, userId);
    const live = (deps.hasLiveOrQueuedRun ?? hasLiveOrQueuedRun)(db, userId, "apply");
    if (unconfirmed >= BACKLOG_PAUSE_AT || live) {
      return { action: "paused", runId: insertPausedRun(db, userId, channel, next, unconfirmed, live), unconfirmed };
    }
    const started = (deps.startExecutor ?? startExecutor)(db, userId, "apply", next, deps.logDir ? { logDir: deps.logDir } : {}, channel);
    return { action: "queued", runId: started.id, channel };
  } catch (e) {
    console.error("[apply continue] run", runId, e);
    return { action: "none", reason: `error: ${String(e)}` };
  }
}

// Called whenever the account's confirmation backlog may have shrunk (approve/reject on /apply)
// or a session freed up (any apply run finished): if a chain is parked as 'paused' and the
// backlog is low enough, hand it to a session. A user_chrome row simply becomes 'queued' (same
// id, so the card keeps its identity); a headless row spawns a fresh run and the placeholder is
// closed out.
export function resumePausedChainIfReady(db: DB, userId: string, deps: ContinueDeps = {}): ContinueResult {
  try {
    const paused = db
      .prepare(
        "SELECT id, channel, options, log_path FROM executor_runs WHERE user_id = ? AND kind = 'apply' AND status = 'paused' ORDER BY id DESC LIMIT 1"
      )
      .get(userId) as { id: number; channel: string; options: string; log_path: string | null } | undefined;
    if (!paused) return { action: "none", reason: "no paused chain" };
    const unconfirmed = unconfirmedCount(db, userId);
    if (unconfirmed > BACKLOG_RESUME_AT) return { action: "none", reason: `backlog still ${unconfirmed} unconfirmed` };
    if ((deps.hasLiveOrQueuedRun ?? hasLiveOrQueuedRun)(db, userId, "apply")) return { action: "none", reason: "another apply run is live or queued" };

    if (paused.channel !== "headless") {
      const logDir = deps.logDir ?? path.join(process.cwd(), "data/executor-logs");
      fs.mkdirSync(logDir, { recursive: true });
      const logPath = paused.log_path ?? path.join(logDir, `run-${paused.id}.log`);
      fs.closeSync(fs.openSync(logPath, "a"));
      const flipped = db
        .prepare("UPDATE executor_runs SET status = 'queued', started_at = datetime('now'), log_path = ?, summary = NULL WHERE id = ? AND status = 'paused'")
        .run(logPath, paused.id);
      if (flipped.changes === 0) return { action: "none", reason: "paused row changed underneath" };
      return { action: "queued", runId: paused.id, channel: "user_chrome" };
    }
    let options: StartOptions = {};
    try {
      options = JSON.parse(paused.options);
    } catch {
      options = {};
    }
    const started = (deps.startExecutor ?? startExecutor)(db, userId, "apply", options, deps.logDir ? { logDir: deps.logDir } : {}, "headless");
    db.prepare("UPDATE executor_runs SET status = 'done', summary = ?, ended_at = datetime('now') WHERE id = ?").run(
      `已由任务 #${started.id} 接续`,
      paused.id
    );
    return { action: "queued", runId: started.id, channel: "headless" };
  } catch (e) {
    console.error("[apply continue] resume", e);
    return { action: "none", reason: `error: ${String(e)}` };
  }
}

// The user started a new plan from /apply: whatever chain of theirs was parked waiting for
// confirmations is superseded — two chains competing for one session would only confuse the board.
export function supersedePausedChain(db: DB, userId: string): number {
  return db
    .prepare(
      "UPDATE executor_runs SET status = 'stopped', summary = '被新的投递计划取代', ended_at = datetime('now') WHERE user_id = ? AND kind = 'apply' AND status = 'paused'"
    )
    .run(userId).changes;
}
