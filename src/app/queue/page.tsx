import { getDb } from "@/lib/db";
import { queueByDirection, pagedQueue, QueueSort, QUEUE_ELIGIBLE_SQL } from "@/apply/queue";
import { QueueBoard } from "./queue-board";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const VALID_SORTS: QueueSort[] = ["score", "fresh", "company"];

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; page?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();

  const matchedTotal = (
    db
      .prepare(
        `SELECT COUNT(*) n FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE a.status='matched' AND ${QUEUE_ELIGIBLE_SQL}`
      )
      .get() as { n: number }
  ).n;
  const scoredTotal = (db.prepare("SELECT COUNT(*) n FROM matches").get() as { n: number }).n;

  // Tab strip: one tab per direction that currently has matched jobs, already ordered exactly
  // the way the user asked (tier ASC then count DESC, "未分类" last) — queueByDirection already
  // implements that ordering for the /apply quota table, so this reuses it verbatim.
  const tabs = queueByDirection(db);

  const requestedDirection = sp.direction;
  const resolvedDirection =
    requestedDirection && tabs.some((t) => t.direction === requestedDirection)
      ? requestedDirection
      : (tabs[0]?.direction ?? null);

  const page = Math.max(1, Number(sp.page) || 1);
  const sort: QueueSort = VALID_SORTS.includes(sp.sort as QueueSort) ? (sp.sort as QueueSort) : "score";

  const result = resolvedDirection
    ? pagedQueue(db, { direction: resolvedDirection, page, pageSize: PAGE_SIZE, sort })
    : { rows: [], total: 0, pages: 1 };

  return (
    <div>
      <h1>
        申请队列 <small>(已匹配 {matchedTotal} / 已打分 {scoredTotal})</small>
      </h1>
      <p className="panel-sub">
        按方向分 tab,每 tab 内按所选排序展示,每页 {PAGE_SIZE} 条。分数 ≥ 阈值且未归档的职位在此,最值钱的排最前。
      </p>
      {tabs.length === 0 ? (
        <p className="text-sub">队列中没有已匹配的职位。</p>
      ) : (
        <QueueBoard
          tabs={tabs.map((t) => ({ direction: t.direction, tier: t.tier, matched: t.matched }))}
          initialDirection={resolvedDirection as string}
          initialPage={page}
          initialSort={sort}
          initialResult={result}
          pageSize={PAGE_SIZE}
        />
      )}
    </div>
  );
}
