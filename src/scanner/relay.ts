import { DB } from "@/lib/db";
import { tryAcquireMatching, releaseMatching } from "@/matcher/inflight";
import { QUEUE_ELIGIBLE_SQL } from "@/apply/queue";
import { iso } from "@/scanner/boards";
import { promoteRecentHighScores } from "@/scanner/retier";
import { listUsers, UserRow } from "@/lib/users";
import { tryLoadProfile, Profile } from "@/lib/profile";

// 打分每小时上限(spec §3.3):免得首次铺开的几万个候选岗一口气跟用户自己用 Claude 抢额度。
// 账号之间共用这一个额度(LLM 后端是机器级的订阅),每轮按人平分。
export const MATCH_HOURLY_CAP = Number(process.env.MATCH_HOURLY_CAP ?? 1500);
export function matchBudget(db: DB, cap = MATCH_HOURLY_CAP): number {
  const n = (db.prepare("SELECT COUNT(*) n FROM matches WHERE created_at >= datetime('now','-1 hour')").get() as { n: number }).n;
  return Math.max(0, cap - n);
}

// 新账号只打分注册前 45 天以内入库的岗(spec 2026-09-13 accounts §4):再早的岗多半已经关了。
export const MATCH_HORIZON_DAYS = 45;
export function matchSinceFor(user: Pick<UserRow, "createdAt">): string {
  const created = Date.parse(user.createdAt);
  const base = Number.isNaN(created) ? Date.now() : created;
  return iso(new Date(base - MATCH_HORIZON_DAYS * 86_400_000));
}

export function unscoredBacklogFor(db: DB, userId: string, since: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) n FROM jobs j JOIN applications a ON a.job_id = j.id AND a.user_id = ?
         LEFT JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
         WHERE m.id IS NULL AND j.created_at >= ? AND ${QUEUE_ELIGIBLE_SQL}`
      )
      .get(userId, since) as { n: number }
  ).n;
}

// Accounts the matcher can work for: a complete profile is what the match prompt needs.
export function matchableUsers(db: DB): { user: UserRow; profile: Profile; since: string }[] {
  const out: { user: UserRow; profile: Profile; since: string }[] = [];
  for (const user of listUsers(db)) {
    const profile = tryLoadProfile(db, user.id);
    if (profile) out.push({ user, profile, since: matchSinceFor(user) });
  }
  return out;
}

// Anything unscored for any matchable account?
export function unscoredBacklog(db: DB): number {
  return matchableUsers(db).reduce((n, m) => n + unscoredBacklogFor(db, m.user.id, m.since), 0);
}

// One incremental matching pass for every matchable account, sharing `limit` between them (the
// jd_review finish chain uses this after JDs came back; the scan pipeline below inlines the same
// loop with its own budget logic).
export async function matchAllUsers(
  db: DB,
  opts: { backend: import("@/llm/types").LlmBackend; limit: number; concurrency?: number }
): Promise<number> {
  const { runMatching } = await import("@/matcher/run");
  const targets = matchableUsers(db);
  let scored = 0;
  const perUser = Math.max(10, Math.floor(opts.limit / Math.max(1, targets.length)));
  for (const t of targets) {
    if (unscoredBacklogFor(db, t.user.id, t.since) === 0) continue;
    const s = await runMatching(db, {
      userId: t.user.id,
      backend: opts.backend,
      profile: { directions: t.profile.directions, work_auth: t.profile.work_auth },
      batchSize: 10,
      threshold: 40,
      limit: perUser,
      since: t.since,
      concurrency: opts.concurrency ?? 6,
    });
    scored += s.scored;
  }
  return scored;
}

// 入库后的接力(tick / 立即扫描 / Chrome 入库共用):去重 → 每个账号各自匹配(共用每小时上限)→ 内推建议 → 高分板块升 core → jd_review。
// fire-and-forget;拿不到匹配锁就返回 false,由下一分钟的 tick 再来。锁与 jd_review finish 链共享(matcher/inflight)。
export function startPostScanPipeline(db: DB): boolean {
  if (!tryAcquireMatching()) return false;
  void (async () => {
    try {
      const { getBackend } = await import("@/llm/registry");
      const { runConsolidate } = await import("@/scanner/consolidate");
      const { runMatching } = await import("@/matcher/run");
      const { runReferralFit } = await import("@/matcher/referral-fit");
      const { maybeStartJdReview } = await import("@/jd-review/relay");
      const backend = getBackend();
      // 顺序固定:先去重(重复行不进匹配),再匹配,最后补正文接力。
      const c = await runConsolidate(db, { backend, groupsPerCall: 15, limitGroups: 20 });
      console.log(`[scan→consolidate] groups ${c.groups}, archived ${c.archived}, errors ${c.errors.length}`);
      const targets = matchableUsers(db);
      const since = iso(new Date(Date.now() - 5000));
      if (targets.length === 0) {
        console.log("[scan→match] no account with a complete profile yet, nothing to score");
      } else {
        const budget = matchBudget(db);
        if (budget > 0) {
          const perUser = Math.max(10, Math.floor(Math.min(200 * targets.length, budget) / targets.length));
          for (const t of targets) {
            if (unscoredBacklogFor(db, t.user.id, t.since) === 0) continue;
            await runMatching(db, {
              userId: t.user.id,
              backend,
              profile: { directions: t.profile.directions, work_auth: t.profile.work_auth },
              batchSize: 10,
              threshold: 40,
              limit: Math.min(200, perUser),
              since: t.since,
              concurrency: 6,
            });
            await runReferralFit(db, { userId: t.user.id, backend, batchSize: 40, limit: 400, concurrency: 4 });
          }
          const promoted = promoteRecentHighScores(db, since);
          if (promoted) console.log(`[scan→retier] promoted ${promoted} boards to core`);
        } else {
          console.log("[scan→match] hourly cap reached, deferring to a later tick");
        }
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
