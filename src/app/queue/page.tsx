import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { queueByDirection, pagedQueue, pagedAllJobs, QUEUE_ELIGIBLE_SQL } from "@/apply/queue";
import { ALL_JOBS_DIRECTION, QUEUE_MODES, QUEUE_SORTS, type QueueModeKey, type QueueSortKey } from "@/app/lib/queue-const";
import { PageHeader, Stat, StatStrip } from "@/app/components/ui";
import { ScanMenu } from "@/app/components/scan-menu";
import { getMessages } from "@/i18n/server";
import { QueueClient } from "./queue-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.queue };
}

const PAGE_SIZE = 25;

// 职位: the ranked apply queue, one tab per direction (tier ASC, count DESC, 未分类 last) plus a
// trailing 全部入库 tab that is the raw scanner output. State lives in the URL so a reload or a
// shared link lands on the same view; ?job=<id> opens that row's detail on arrival.
export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; page?: string; sort?: string; mode?: string; q?: string; job?: string }>;
}) {
  const sp = await searchParams;
  const m = await getMessages();
  const db = getDb();

  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const visibleTotal = count("SELECT COUNT(*) n FROM jobs WHERE visa_flag IS NULL AND loc_flag IS NULL");
  const visaHidden = count("SELECT COUNT(*) n FROM jobs WHERE visa_flag IS NOT NULL");
  const locHidden = count("SELECT COUNT(*) n FROM jobs WHERE visa_flag IS NULL AND loc_flag IS NOT NULL");
  const scoredTotal = count("SELECT COUNT(*) n FROM matches");
  const matchedTotal = count(
    `SELECT COUNT(*) n FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.status='matched' AND ${QUEUE_ELIGIBLE_SQL}`
  );

  const tabs = queueByDirection(db);
  const requested = sp.direction;
  const direction =
    requested === ALL_JOBS_DIRECTION
      ? ALL_JOBS_DIRECTION
      : requested && tabs.some((t) => t.direction === requested)
      ? requested
      : (tabs[0]?.direction ?? ALL_JOBS_DIRECTION);
  const isAllTab = direction === ALL_JOBS_DIRECTION;

  const page = Math.max(1, Number(sp.page) || 1);
  const defaultSort: QueueSortKey = isAllTab ? "fresh" : "composite";
  const sort: QueueSortKey = (QUEUE_SORTS as readonly string[]).includes(sp.sort ?? "") ? (sp.sort as QueueSortKey) : defaultSort;
  const mode: QueueModeKey = (QUEUE_MODES as readonly string[]).includes(sp.mode ?? "") ? (sp.mode as QueueModeKey) : "all";
  const q = sp.q?.trim() ?? "";
  const jobId = Number(sp.job);
  const initialJobId = Number.isInteger(jobId) && jobId > 0 ? jobId : null;

  const result = isAllTab
    ? pagedAllJobs(db, { page, pageSize: PAGE_SIZE, sort, q: q || undefined })
    : pagedQueue(db, { direction, page, pageSize: PAGE_SIZE, sort, mode: mode === "all" ? undefined : mode, q: q || undefined });

  return (
    <>
      <PageHeader title={m.queue.title} actions={<ScanMenu />}>
        <StatStrip compact>
          <Stat label={m.queue.stats.visible} value={visibleTotal.toLocaleString()} hint={m.queue.stats.visibleHint} />
          <Stat label={m.queue.stats.scored} value={scoredTotal.toLocaleString()} hint={m.queue.stats.scoredHint} />
          <Stat label={m.queue.stats.ready} value={matchedTotal.toLocaleString()} tone="accent" hint={m.queue.stats.readyHint} />
          <Stat label={m.queue.stats.hidden} value={(visaHidden + locHidden).toLocaleString()} sub={m.queue.stats.hiddenSub(visaHidden, locHidden)} hint={m.queue.stats.hiddenHint} />
        </StatStrip>
      </PageHeader>
      <QueueClient
        tabs={tabs.map((t) => ({
          direction: t.direction,
          tier: t.tier,
          matched: t.matched,
          referralSuggested: t.referralSuggested,
          directSuggested: t.directSuggested,
        }))}
        allJobsCount={visibleTotal}
        initialDirection={direction}
        initialPage={page}
        initialSort={sort}
        initialMode={mode}
        initialQuery={q}
        initialResult={result}
        initialJobId={initialJobId}
        pageSize={PAGE_SIZE}
      />
    </>
  );
}
