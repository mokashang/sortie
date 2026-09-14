import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pagedQueue, pagedAllJobs, ALL_JOBS_DIRECTION, QueueSort, QUEUE_ELIGIBLE_SQL } from "@/apply/queue";
import { isApplyMode } from "@/apply/mode";
import { QUEUE_ORDER_SQL } from "@/apply/rank";
import { withUser } from "@/lib/actor";

const VALID_SORTS: QueueSort[] = ["composite", "score", "fresh", "company"];

// 申请队列:已匹配(未归档)的职位,按 梯队 × 分数 × 新鲜度 排序。
// 排序键:tier 越小越优先(tier 1 = 最想去);同 tier 内按综合分(分数减时间惩罚,src/apply/rank.ts)高者先;再按入库时间新者先。
//
// ?direction= (a direction slug, 未分类, or __all__) switches this endpoint into the interactive /queue page's paged mode (delegates to
// pagedQueue — {rows,total,pages}, honoring ?page=/?pageSize=/?sort= too). Without ?direction=
// it stays the flat, unpaged list the executor prompt polls via ?min= (unchanged response shape:
// {queue:[...]}) — see src/executor/prompts.ts's own curl example of this exact contract.
export const GET = withUser(async (req, { userId }) => {
  const url = new URL(req.url);
  const direction = url.searchParams.get("direction");
  const db = getDb();

  if (direction) {
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(url.searchParams.get("pageSize") ?? "25") || 25;
    const sortParam = url.searchParams.get("sort") ?? "composite";
    const sort: QueueSort = VALID_SORTS.includes(sortParam as QueueSort) ? (sortParam as QueueSort) : "composite";
    // ?mode=referral|direct — the /queue 全部/建议内推/海投 filter (direction tabs only).
    const modeParam = url.searchParams.get("mode");
    const mode = isApplyMode(modeParam) ? modeParam : undefined;
    // ?q= — company/title search (both the direction tabs and the 全部入库 tab).
    const q = url.searchParams.get("q")?.trim() || undefined;
    // ALL_JOBS_DIRECTION is the merged /queue page's "全部入库" tab: every visible job, scored or
    // not — same {rows,total,pages} shape, rows additionally carry source/created_at/in_queue.
    const result =
      direction === ALL_JOBS_DIRECTION
        ? pagedAllJobs(db, userId, { page, pageSize, sort, q })
        : pagedQueue(db, userId, { direction, page, pageSize, sort, mode, q });
    return NextResponse.json(result);
  }

  let minScore = Number(url.searchParams.get("min") ?? "0");
  if (Number.isNaN(minScore)) minScore = 0;
  const rows = db
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.apply_url, j.source, j.posted_at,
              m.direction, m.score, m.tier, m.reason, a.status
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
       WHERE a.user_id = ? AND a.status = 'matched' AND ${QUEUE_ELIGIBLE_SQL} AND m.score >= ?
       ORDER BY ${QUEUE_ORDER_SQL}
       LIMIT 1000`
    )
    .all(userId, minScore);
  return NextResponse.json({ queue: rows });
});
