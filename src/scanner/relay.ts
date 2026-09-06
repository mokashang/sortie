import { DB } from "@/lib/db";
import { tryAcquireMatching, releaseMatching } from "@/matcher/inflight";
import { QUEUE_ELIGIBLE_SQL } from "@/apply/queue";
import { iso } from "@/scanner/boards";
import { promoteRecentHighScores } from "@/scanner/retier";

// 打分每小时上限(spec §3.3):免得首次铺开的几万个候选岗一口气跟用户自己用 Claude 抢额度。
export const MATCH_HOURLY_CAP = Number(process.env.MATCH_HOURLY_CAP ?? 1500);
export function matchBudget(db: DB, cap = MATCH_HOURLY_CAP): number {
  const n = (db.prepare("SELECT COUNT(*) n FROM matches WHERE created_at >= datetime('now','-1 hour')").get() as { n: number }).n;
  return Math.max(0, cap - n);
}
export function unscoredBacklog(db: DB): number {
  return (db.prepare(`SELECT COUNT(*) n FROM jobs j JOIN applications a ON a.job_id = j.id LEFT JOIN matches m ON m.job_id = j.id WHERE m.id IS NULL AND ${QUEUE_ELIGIBLE_SQL}`).get() as { n: number }).n;
}

// 入库后的接力(tick / 立即扫描 / Chrome 入库共用):去重 → 匹配(每小时上限)→ 内推建议 → 高分板块升 core → jd_review。
// fire-and-forget;拿不到匹配锁就返回 false,由下一分钟的 tick 再来。锁与 jd_review finish 链共享(matcher/inflight)。
export function startPostScanPipeline(db: DB): boolean {
  if (!tryAcquireMatching()) return false;
  void (async () => {
    try {
      const { loadProfile } = await import("@/lib/profile");
      const { getBackend } = await import("@/llm/registry");
      const { runConsolidate } = await import("@/scanner/consolidate");
      const { runMatching } = await import("@/matcher/run");
      const { runReferralFit } = await import("@/matcher/referral-fit");
      const { maybeStartJdReview } = await import("@/jd-review/relay");
      const profile = loadProfile();
      const backend = getBackend();
      // 顺序固定:先去重(重复行不进匹配),再匹配,最后补正文接力。
      const c = await runConsolidate(db, { backend, groupsPerCall: 15, limitGroups: 20 });
      console.log(`[scan→consolidate] groups ${c.groups}, archived ${c.archived}, errors ${c.errors.length}`);
      const budget = matchBudget(db);
      const since = iso(new Date(Date.now() - 5000));
      if (budget > 0) {
        await runMatching(db, {
          backend,
          profile: { directions: profile.directions, work_auth: profile.work_auth },
          batchSize: 10,
          threshold: 40,
          limit: Math.min(200, budget),
          concurrency: 6,
        });
        await runReferralFit(db, { backend, batchSize: 40, limit: 400, concurrency: 4 });
        const promoted = promoteRecentHighScores(db, since);
        if (promoted) console.log(`[scan→retier] promoted ${promoted} boards to core`);
      } else {
        console.log("[scan→match] hourly cap reached, deferring to a later tick");
      }
      console.log("[scan→jd_review]", maybeStartJdReview(db));
    } catch (e) {
      console.error("[scan→match]", e);
    } finally {
      releaseMatching();
    }
  })().catch((e) => console.error("[scan→match] unhandled", e));
  return true;
}
