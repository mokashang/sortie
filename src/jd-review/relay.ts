import { DB } from "@/lib/db";
import { startExecutor, hasLiveRun } from "@/executor/runner";
import { pendingJdReviewCount } from "@/jd-review/service";
import { ownerId } from "@/lib/users";

export const JD_REVIEW_DAILY_CAP = 10;      // 每天最多自动接力 10 个 run(≈400 页),防失控;用户可手动再点
export const JD_REVIEW_DEFAULT_LIMIT = 40;

export interface RelayDeps {
  startExecutor?: typeof startExecutor;
  hasLiveRun?: typeof hasLiveRun;
  pendingCount?: (db: DB) => number;
}
export type RelayResult = { started: true; runId: number } | { started: false; reason: "disabled" | "no_pending" | "run_live" | "daily_cap" | "no_owner" | "error" };

export function jdReviewRunsToday(db: DB): number {
  return (db.prepare(
    "SELECT COUNT(*) n FROM executor_runs WHERE kind = 'jd_review' AND started_at >= datetime('now', 'start of day')"
  ).get() as { n: number }).n;
}

// 扫描链末尾与 jd_review run 结束时都调用:有待补、无活 run、未到每日上限 → 启一个 headless run。
// 运维开关:.env 里设 JD_REVIEW_RELAY_DISABLED=1 就一律不自动接力(/apply 的「补正文」按钮走
// /api/executor/start,不受影响)。2026-09-09 起 Mac 生产先关掉,等切到 Windows 后那边不设即恢复。
export function maybeStartJdReview(db: DB, deps: RelayDeps = {}): RelayResult {
  if (process.env.JD_REVIEW_RELAY_DISABLED) return { started: false, reason: "disabled" };
  const pending = (deps.pendingCount ?? pendingJdReviewCount)(db);
  if (pending <= 0) return { started: false, reason: "no_pending" };
  // jd_review reads shared job facts, but a run must belong to some account (its token, its log,
  // its 助手 card): the box's owner runs it on everyone's behalf.
  const owner = ownerId(db);
  if (!owner) return { started: false, reason: "no_owner" };
  if ((deps.hasLiveRun ?? hasLiveRun)(db, owner, "jd_review")) return { started: false, reason: "run_live" };
  if (jdReviewRunsToday(db) >= JD_REVIEW_DAILY_CAP) return { started: false, reason: "daily_cap" };
  try {
    const r = (deps.startExecutor ?? startExecutor)(db, owner, "jd_review", { limit: JD_REVIEW_DEFAULT_LIMIT }, {}, "headless");
    return { started: true, runId: r.id };
  } catch {
    return { started: false, reason: "error" };
  }
}
