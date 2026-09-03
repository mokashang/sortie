import { DB } from "@/lib/db";
import { startExecutor, hasLiveRun } from "@/executor/runner";
import { pendingJdReviewCount } from "@/jd-review/service";

export const JD_REVIEW_DAILY_CAP = 10;      // 每天最多自动接力 10 个 run(≈400 页),防失控;用户可手动再点
export const JD_REVIEW_DEFAULT_LIMIT = 40;

export interface RelayDeps {
  startExecutor?: typeof startExecutor;
  hasLiveRun?: typeof hasLiveRun;
  pendingCount?: (db: DB) => number;
}
export type RelayResult = { started: true; runId: number } | { started: false; reason: "no_pending" | "run_live" | "daily_cap" | "error" };

export function jdReviewRunsToday(db: DB): number {
  return (db.prepare(
    "SELECT COUNT(*) n FROM executor_runs WHERE kind = 'jd_review' AND started_at >= datetime('now', 'start of day')"
  ).get() as { n: number }).n;
}

// 扫描链末尾与 jd_review run 结束时都调用:有待补、无活 run、未到每日上限 → 启一个 headless run。
export function maybeStartJdReview(db: DB, deps: RelayDeps = {}): RelayResult {
  const pending = (deps.pendingCount ?? pendingJdReviewCount)(db);
  if (pending <= 0) return { started: false, reason: "no_pending" };
  if ((deps.hasLiveRun ?? hasLiveRun)(db, "jd_review")) return { started: false, reason: "run_live" };
  if (jdReviewRunsToday(db) >= JD_REVIEW_DAILY_CAP) return { started: false, reason: "daily_cap" };
  try {
    const r = (deps.startExecutor ?? startExecutor)(db, "jd_review", { limit: JD_REVIEW_DEFAULT_LIMIT }, {}, "headless");
    return { started: true, runId: r.id };
  } catch {
    return { started: false, reason: "error" };
  }
}
