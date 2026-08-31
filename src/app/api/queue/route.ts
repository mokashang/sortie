import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// 申请队列:已匹配(未归档)的职位,按 梯队 × 分数 × 新鲜度 排序。
// 排序键:tier 越小越优先(tier 1 = 最想去);同 tier 内 score 高者先;再按入库时间新者先。
export async function GET(req: Request) {
  const url = new URL(req.url);
  let minScore = Number(url.searchParams.get("min") ?? "0");
  if (Number.isNaN(minScore)) minScore = 0;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.apply_url, j.source, j.posted_at,
              m.direction, m.score, m.tier, m.reason, a.status
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched' AND m.score >= ?
       ORDER BY COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC
       LIMIT 1000`
    )
    .all(minScore);
  return NextResponse.json({ queue: rows });
}
