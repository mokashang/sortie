import { TIME_PENALTY_RULE as R } from "@/app/lib/time-penalty";

// 队列排序用的综合分(spec 2026-09-06 §5.2,2026-09-11 放宽):Claude 分数 − 时间惩罚。
// 规则的常量、理由和 TS 等价实现都在 src/app/lib/time-penalty.ts;这里只把它拼成 SQL(以 j = jobs、m = matches 为别名):
//   发布 14 天内不扣;之后每 5 天扣 1 分,封顶 10;知名公司(m.referral_fit = 1)每 10 天扣 1 分,封顶 5;
//   没有发布日期按 30 天算。只影响排序,不改 matches.score;页面仍显示原始分。
// 效果:刚发的 80 分仍排在 90 天前的 88 分(−10 → 78)前面;但 30 天前的 88 分知名公司岗(−1 → 87)排在刚发的 86 分前面。
const AGE_DAYS_SQL = `(julianday('now') - COALESCE(julianday(j.posted_at), julianday('now','-${R.unknownAgeDays} days')))`;
const BIG_SQL = "m.referral_fit = 1";
export const TIME_PENALTY_SQL =
  `MIN(CASE WHEN ${BIG_SQL} THEN ${R.bigCapPoints} ELSE ${R.capPoints} END, ` +
  `MAX(0, CAST((${AGE_DAYS_SQL} - ${R.graceDays}) / (CASE WHEN ${BIG_SQL} THEN ${R.bigStepDays} ELSE ${R.stepDays} END) AS INTEGER)))`;
export const COMPOSITE_SCORE_SQL = `(m.score - ${TIME_PENALTY_SQL})`;

// 方向优先级(1 最想去)仍在最前;同档内按综合分,再按原始分,再按入库时间新者先。
export const QUEUE_ORDER_SQL = `COALESCE(m.tier, 9) ASC, ${COMPOSITE_SCORE_SQL} DESC, m.score DESC, j.created_at DESC`;
