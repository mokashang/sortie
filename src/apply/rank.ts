// 队列排序用的综合分(spec 2026-09-06 §5.2):Claude 分数 − 时间惩罚。
// 发布 7 天内不扣;之后每 4 天扣 1 分,封顶 15(60 天以上一律扣 15);没有发布日期的按 35 天算(扣 7)。
// 只影响排序,不改 matches.score;页面仍显示原始分。效果:刚发的 80 分排在三个月前的 88 分前面,但排不过刚发的 90 分。
export const COMPOSITE_SCORE_SQL =
  "(m.score - MIN(15, MAX(0, CAST((julianday('now') - COALESCE(julianday(j.posted_at), julianday('now','-35 days')) - 7) / 4 AS INTEGER))))";

// 方向优先级(1 最想去)仍在最前;同档内按综合分,再按原始分,再按入库时间新者先。
export const QUEUE_ORDER_SQL = `COALESCE(m.tier, 9) ASC, ${COMPOSITE_SCORE_SQL} DESC, m.score DESC, j.created_at DESC`;
