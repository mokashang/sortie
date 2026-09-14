import { DB } from "@/lib/db";
import type { ChainInfo, ModeCounts, RunOutcome } from "@/app/lib/run-outcome";

export type { RunOutcome } from "@/app/lib/run-outcome";

// 「任务 #N 已完成」以前只表示会话正常收工,跟计划完成了几份没有关系(2026-09-13 任务 #68:计划海投 70,
// 提交 5,标签照样是已完成)。现在:取件时把 run id 盖在 applications.run_id 上,run 到终态时服务器按
// run_id 数一遍,把 计划数 / 实际数 / 各去向 写进 executor_runs.outcome;界面据此显示 已完成 / 未完成
// 和「海投 5/70」。接力段(options.chain)的计划数取整条链的,实际数 = 前几段 + 本段。

// The apply run currently driving the browser, if any. takeNextApplication / takeNextReferral stamp
// it on the rows they claim. At most one apply run is live at a time (hasLiveOrQueuedRun), so the
// newest 'running' row is the one asking; null when /api/apply/next is called with no run live.
export function currentApplyRunId(db: DB, userId: string): number | null {
  const row = db
    .prepare("SELECT id FROM executor_runs WHERE user_id = ? AND kind = 'apply' AND status = 'running' ORDER BY id DESC LIMIT 1")
    .get(userId) as { id: number } | undefined;
  return row?.id ?? null;
}

// Planned counts from a run's options: per-direction quotas (options.plan) or a targeted jobIds
// run. Runs with neither — resume-only, referral_check, ... — have nothing to measure against.
export function plannedCounts(options: unknown): ModeCounts | null {
  if (!options || typeof options !== "object") return null;
  const o = options as { plan?: { count?: number; mode?: string }[]; jobIds?: unknown[]; mode?: string };
  const planned = { direct: 0, referral: 0 };
  if (Array.isArray(o.plan) && o.plan.length > 0) {
    for (const p of o.plan) {
      const n = Math.max(0, Math.floor(Number(p?.count) || 0));
      if (p?.mode === "referral") planned.referral += n;
      else planned.direct += n;
    }
  } else if (Array.isArray(o.jobIds) && o.jobIds.length > 0) {
    if (o.mode === "referral") planned.referral = o.jobIds.length;
    else planned.direct = o.jobIds.length;
  } else {
    return null;
  }
  return planned;
}

export interface ClaimedRow {
  status: string;
  confirm_decision: string | null;
  needs_manual_reason: string | null;
  pending_questions: string | null;
}
// manual = a referral company where nobody could be contacted (找不到人); info = any 待处理 card.
export type RowBucket = "submitted" | "awaiting" | "manual" | "archived" | "info" | "none";

// What one claimed row means for the run that claimed it. Count semantics follow the protocol
// (CLAUDE.md §3.3): 海投 = filled and reported awaiting_confirm — a later submit or a user rejection
// keeps it counted, the fill happened; 内推 = entered referral_seeking and stayed there with someone
// to contact — a 找不到人 company achieved nothing. Rows claimed but never reported (and later
// reclaimed) count for nothing.
export function rowResult(r: ClaimedRow): { mode: "direct" | "referral"; achieved: boolean; bucket: RowBucket } {
  if (r.status === "submitted") return { mode: "direct", achieved: true, bucket: "submitted" };
  if (r.status === "awaiting_confirm") return { mode: "direct", achieved: true, bucket: "awaiting" };
  if (r.status === "referral_seeking" || r.status === "referral_ready") {
    return r.needs_manual_reason
      ? { mode: "referral", achieved: false, bucket: "manual" }
      : { mode: "referral", achieved: true, bucket: "none" };
  }
  if (r.status === "archived") return { mode: "direct", achieved: false, bucket: "archived" };
  // A 待处理 card is waiting on the user (spec 2026-09-13-todo-list-design): a missing answer or
  // file, a login wall, something to finish by hand, an executor error, or a rejected fill. The
  // rejected fill still counts as achieved — the form was filled — the rest were never filled.
  if (r.status === "needs_info" || r.pending_questions || r.needs_manual_reason) {
    return { mode: "direct", achieved: r.confirm_decision === "rejected", bucket: "info" };
  }
  return { mode: "direct", achieved: false, bucket: "none" };
}

// Snapshot of what a run did, from the rows it claimed (applications.run_id). null for runs that
// are not apply runs or have no plan to measure against.
export function computeRunOutcome(db: DB, runId: number): RunOutcome | null {
  const run = db.prepare("SELECT kind, options FROM executor_runs WHERE id = ?").get(runId) as
    | { kind: string; options: string }
    | undefined;
  if (!run || run.kind !== "apply") return null;
  let options: unknown = {};
  try {
    options = JSON.parse(run.options);
  } catch {
    options = {};
  }
  const chain = (options as { chain?: ChainInfo }).chain;
  const planned = chain ? chain.planned : plannedCounts(options);
  if (!planned) return null;

  const rows = db
    .prepare("SELECT status, confirm_decision, needs_manual_reason, pending_questions FROM applications WHERE run_id = ?")
    .all(runId) as ClaimedRow[];
  const own = { direct: 0, referral: 0 };
  const buckets = { submitted: 0, awaiting: 0, manual: 0, archived: 0, info: 0, none: 0 };
  for (const r of rows) {
    const res = rowResult(r);
    if (res.achieved) own[res.mode] += 1;
    buckets[res.bucket] += 1;
  }
  const achieved = chain
    ? { direct: chain.before.direct + own.direct, referral: chain.before.referral + own.referral }
    : own;
  return {
    planned,
    achieved,
    own,
    submitted: buckets.submitted,
    awaiting: buckets.awaiting,
    manual: buckets.manual,
    archived: buckets.archived,
    info: buckets.info,
    complete: achieved.direct >= planned.direct && achieved.referral >= planned.referral,
    ...(chain ? { chain: { root: chain.root, step: chain.step } } : {}),
  };
}

// Compute and store the outcome for a run that just reached a terminal status. Bookkeeping only:
// never throws, so a bug here cannot break the finish/stop/reap that called it.
export function settleRunOutcome(db: DB, runId: number): RunOutcome | null {
  try {
    const outcome = computeRunOutcome(db, runId);
    db.prepare("UPDATE executor_runs SET outcome = ? WHERE id = ?").run(outcome ? JSON.stringify(outcome) : null, runId);
    return outcome;
  } catch (e) {
    console.error("[run-outcome] settle failed for run", runId, e);
    return null;
  }
}
