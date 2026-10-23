import { DB, logEvent } from "@/lib/db";
import type { ChainEnd, ModeCounts, RunOutcome } from "@/app/lib/run-outcome";
import { APPLY_CHUNK_SIZE } from "@/app/lib/run-outcome";
import { startExecutor, ExecutorChannel, StartOptions } from "@/executor/runner";
import { notify } from "@/lib/notify";
import { serverLang } from "@/lib/prefs";
import { messages } from "@/i18n/messages";

// 任务级的待处理卡(2026-10-16,用户定的「非问我不可的事走待处理卡 + ntfy」)。任务 #453 的会话把「接下来
// 怎么办」写进了任务摘要,#446 的会话也是(「请允许提交,或者你自己点」)——摘要只在助手卡上露两行,
// 下一个任务一来就被挤进折叠的历史,用户根本看不到,两条路都成了死胡同。现在两种情况都是一张卡:
//   chain  — 投递计划(接力链)没跑完就停了:连续两段零进展,或段数到顶(src/apply/continue.ts 记下的
//            outcome.end)。卡上列出剩下的条目,「继续跑剩下的」按剩下的开一个新计划。
//   failed — 一个定向任务(jobIds)报了 failed / 被回收,还有没动过的岗。「让助手再试一次」把它们排成
//            新的定向任务。
// 「不用了」收起。处理过的卡记一条 plan_alert_resolved 事件,不再出现;卡只看最近 14 天。

export const PLAN_ALERT_WINDOW_DAYS = 14;
const STUCK: ChainEnd["reason"][] = ["no_progress", "too_long"];

export interface PlanAlertEntry {
  direction: string;
  count: number;
  mode: "direct" | "referral";
}

export interface PlanAlert {
  runId: number;
  kind: "chain" | "failed";
  // chain: the plan's first task (#449); failed: the task itself.
  root: number;
  reason: "no_progress" | "too_long" | "failed";
  endedAt: string | null;
  // chain only: the whole plan against what got done, and what is left of it.
  planned: ModeCounts | null;
  achieved: ModeCounts | null;
  remaining: PlanAlertEntry[];
  // failed only: the task's jobs nobody touched, out of how many it had.
  untouched: number[];
  total: number;
  mode: "direct" | "referral";
  // What the assistant wrote when it finished — often the only explanation there is.
  summary: string | null;
}

interface RunRow {
  id: number;
  status: string;
  channel: string;
  options: string;
  outcome: string | null;
  summary: string | null;
  ended_at: string | null;
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Jobs of a targeted run still sitting in the queue untouched: 'matched' and not a paused 待处理
// card (those carry pending_questions / a reason and already have their own card), and not taken
// by a later run since.
function untouchedJobs(db: DB, userId: string, runId: number, jobIds: number[]): number[] {
  if (jobIds.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT job_id FROM applications WHERE user_id = ? AND status = 'matched' AND needs_manual_reason IS NULL
         AND (pending_questions IS NULL OR pending_questions = '[]') AND (run_id IS NULL OR run_id <= ?)
         AND job_id IN (${jobIds.map(() => "?").join(",")})`
    )
    .all(userId, runId, ...jobIds) as { job_id: number }[];
  return rows.map((r) => r.job_id);
}

function alertFor(db: DB, userId: string, r: RunRow): PlanAlert | null {
  const options = parse<StartOptions>(r.options, {});
  const outcome = parse<RunOutcome | null>(r.outcome, null);
  const end = outcome?.end;
  if (end && STUCK.includes(end.reason)) {
    return {
      runId: r.id,
      kind: "chain",
      root: outcome?.chain?.root ?? options.chain?.root ?? r.id,
      reason: end.reason as "no_progress" | "too_long",
      endedAt: r.ended_at,
      planned: outcome?.planned ?? null,
      achieved: outcome?.achieved ?? null,
      remaining: (end.dropped ?? []).filter((e) => e.count > 0),
      untouched: [],
      total: 0,
      mode: "direct",
      summary: r.summary,
    };
  }
  const jobIds = Array.isArray(options.jobIds) ? options.jobIds.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (r.status === "failed" && jobIds.length > 0) {
    const untouched = untouchedJobs(db, userId, r.id, jobIds);
    if (untouched.length === 0) return null;
    return {
      runId: r.id,
      kind: "failed",
      root: r.id,
      reason: "failed",
      endedAt: r.ended_at,
      planned: null,
      achieved: null,
      remaining: [],
      untouched,
      total: jobIds.length,
      mode: options.mode === "referral" ? "referral" : "direct",
      summary: r.summary,
    };
  }
  return null;
}

function candidateRuns(db: DB, userId: string, runId?: number): RunRow[] {
  return db
    .prepare(
      `SELECT id, status, channel, options, outcome, summary, ended_at FROM executor_runs r
       WHERE user_id = ? AND kind = 'apply' AND status IN ('done','failed') AND ended_at > datetime('now', ?)
         ${runId != null ? "AND id = ?" : ""}
         AND NOT EXISTS (SELECT 1 FROM events e WHERE e.kind = 'plan_alert_resolved' AND e.entity = 'run' AND e.entity_id = r.id)
       ORDER BY id DESC`
    )
    .all(userId, `-${PLAN_ALERT_WINDOW_DAYS} days`, ...(runId != null ? [runId] : [])) as RunRow[];
}

export function planAlerts(db: DB, userId: string): PlanAlert[] {
  const out: PlanAlert[] = [];
  for (const r of candidateRuns(db, userId)) {
    const a = alertFor(db, userId, r);
    if (a) out.push(a);
  }
  return out;
}

export function planAlertFor(db: DB, userId: string, runId: number): PlanAlert | null {
  const r = candidateRuns(db, userId, runId)[0];
  return r ? alertFor(db, userId, r) : null;
}

export interface ResolveDeps {
  startExecutor?: typeof startExecutor;
}

// The card's buttons. continue: the rest of the plan as a new plan / the untouched jobs as a new
// targeted task, queued behind whatever is on (tasks run side by side on the Chrome channel).
export function resolvePlanAlert(
  db: DB,
  userId: string,
  runId: number,
  action: "continue" | "dismiss",
  deps: ResolveDeps = {}
): { runId: number | null } {
  const alert = planAlertFor(db, userId, runId);
  if (!alert) throw new Error(`plan alert: task #${runId} has nothing waiting on you`);
  let started: number | null = null;
  if (action === "continue") {
    const run = db.prepare("SELECT channel, options FROM executor_runs WHERE id = ?").get(runId) as { channel: string; options: string };
    const channel: ExecutorChannel = run.channel === "headless" ? "headless" : "user_chrome";
    const prev = parse<StartOptions>(run.options, {});
    const options: StartOptions =
      alert.kind === "chain"
        ? { plan: alert.remaining.map((e) => ({ ...e })), chunk: typeof prev.chunk === "number" && prev.chunk > 0 ? prev.chunk : APPLY_CHUNK_SIZE }
        : { jobIds: alert.untouched, mode: alert.mode };
    if (alert.kind === "chain" && alert.remaining.length === 0) throw new Error(`plan alert: task #${runId} has nothing left to run`);
    started = (deps.startExecutor ?? startExecutor)(db, userId, "apply", options, channel === "user_chrome" ? { queueBehind: true } : {}, channel).id;
  }
  logEvent(db, "plan_alert_resolved", { userId, entity: "run", entityId: runId, payload: { action, runId: started } });
  return { runId: started };
}

// A targeted task the assistant gave up on (finish route): push now, the card is already there.
export function notifyFailedRun(db: DB, userId: string, runId: number, push?: (title: string, body: string) => void): boolean {
  try {
    const alert = planAlertFor(db, userId, runId);
    if (!alert || alert.kind !== "failed") return false;
    const t = messages[serverLang()].notify.plan;
    const send = push ?? ((a: string, b: string) => void notify(a, b, { priority: "high", account: { db, userId } }));
    send(t.failedTitle(runId), t.failedBody(alert.untouched.length));
    return true;
  } catch (e) {
    console.error("[plan-alerts] notify failed for run", runId, e);
    return false;
  }
}
