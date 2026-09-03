import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pagedQueue, QueueSort } from "@/apply/queue";

const VALID_SORTS: QueueSort[] = ["score", "fresh", "company"];

// 申请队列:已匹配(未归档)的职位,按 梯队 × 分数 × 新鲜度 排序。
// 排序键:tier 越小越优先(tier 1 = 最想去);同 tier 内 score 高者先;再按入库时间新者先。
//
// ?direction= switches this endpoint into the interactive /queue page's paged mode (delegates to
// pagedQueue — {rows,total,pages}, honoring ?page=/?pageSize=/?sort= too). Without ?direction=
// it stays the flat, unpaged list the executor prompt polls via ?min= (unchanged response shape:
// {queue:[...]}) — see src/executor/prompts.ts's own curl example of this exact contract.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const direction = url.searchParams.get("direction");

  if (direction) {
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const pageSize = Number(url.searchParams.get("pageSize") ?? "25") || 25;
    const sortParam = url.searchParams.get("sort") ?? "score";
    const sort: QueueSort = VALID_SORTS.includes(sortParam as QueueSort) ? (sortParam as QueueSort) : "score";
    const result = pagedQueue(getDb(), { direction, page, pageSize, sort });
    return NextResponse.json(result);
  }

  let minScore = Number(url.searchParams.get("min") ?? "0");
  if (Number.isNaN(minScore)) minScore = 0;
  const rows = getDb()
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.apply_url, j.source, j.posted_at,
              m.direction, m.score, m.tier, m.reason, a.status
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched' AND j.loc_flag IS NULL AND m.score >= ?
       ORDER BY COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC
       LIMIT 1000`
    )
    .all(minScore);
  return NextResponse.json({ queue: rows });
}
