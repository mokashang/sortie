import { getDb } from "@/lib/db";
import { queueByDirection, pagedQueue, pagedAllJobs, QueueSort, ALL_JOBS_DIRECTION, QUEUE_ELIGIBLE_SQL } from "@/apply/queue";
import { QueueBoard } from "./queue-board";
import { ScanButton } from "./scan-button";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const VALID_SORTS: QueueSort[] = ["score", "fresh", "company"];

// The single "职位" section: the old /jobs page (funnel counts, scan button, raw listing) merged
// into the direction-tabbed apply queue. The raw listing lives on as the trailing "全部入库" tab.
export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; page?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const db = getDb();

  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  // "可见" is the population the 全部入库 tab draws from (visa_flag IS NULL AND loc_flag IS NULL);
  // the two hidden counts explain what the hard filters removed and are mutually exclusive.
  const visibleTotal = count("SELECT COUNT(*) n FROM jobs WHERE visa_flag IS NULL AND loc_flag IS NULL");
  const visaHidden = count("SELECT COUNT(*) n FROM jobs WHERE visa_flag IS NOT NULL");
  const locHidden = count("SELECT COUNT(*) n FROM jobs WHERE visa_flag IS NULL AND loc_flag IS NOT NULL");
  const scoredTotal = count("SELECT COUNT(*) n FROM matches");
  const matchedTotal = count(
    `SELECT COUNT(*) n FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.status='matched' AND ${QUEUE_ELIGIBLE_SQL}`
  );

  // Tab strip: one tab per direction that currently has matched jobs, already ordered exactly
  // the way the user asked (tier ASC then count DESC, "未分类" last) — queueByDirection already
  // implements that ordering for the /apply quota table, so this reuses it verbatim.
  const tabs = queueByDirection(db);

  const requestedDirection = sp.direction;
  const resolvedDirection =
    requestedDirection === ALL_JOBS_DIRECTION
      ? ALL_JOBS_DIRECTION
      : requestedDirection && tabs.some((t) => t.direction === requestedDirection)
      ? requestedDirection
      : (tabs[0]?.direction ?? ALL_JOBS_DIRECTION);

  const page = Math.max(1, Number(sp.page) || 1);
  // The raw listing defaults to scan order (what the old /jobs page showed); queue tabs to score.
  const defaultSort: QueueSort = resolvedDirection === ALL_JOBS_DIRECTION ? "fresh" : "score";
  const sort: QueueSort = VALID_SORTS.includes(sp.sort as QueueSort) ? (sp.sort as QueueSort) : defaultSort;

  const result =
    resolvedDirection === ALL_JOBS_DIRECTION
      ? pagedAllJobs(db, { page, pageSize: PAGE_SIZE, sort })
      : pagedQueue(db, { direction: resolvedDirection, page, pageSize: PAGE_SIZE, sort });

  return (
    <div>
      <h1>
        职位{" "}
        <small>
          (入库可见 {visibleTotal} · 已打分 {scoredTotal} · 已入队 {matchedTotal} · 已隐藏 {visaHidden} 个签证不符 ·{" "}
          {locHidden} 个海外)
        </small>
      </h1>
      <ScanButton />
      <p className="panel-sub">
        按方向分 tab,每 tab 内按所选排序展示,每页 {PAGE_SIZE} 条。分数 ≥ 阈值且未归档的职位在方向 tab 里,最值钱的排最前;
        「全部入库」是扫描进来的全部可见职位(含未打分)。每行的「建议内推 / 海投」是 Claude 的建议,可逐条改;
        「投递」页按这个模式分开取件。
      </p>
      <QueueBoard
        tabs={tabs.map((t) => ({
          direction: t.direction,
          tier: t.tier,
          matched: t.matched,
          referralSuggested: t.referralSuggested,
          directSuggested: t.directSuggested,
        }))}
        allJobsCount={visibleTotal}
        initialDirection={resolvedDirection}
        initialPage={page}
        initialSort={sort}
        initialResult={result}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
