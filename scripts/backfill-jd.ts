import { getDb, logEvent } from "../src/lib/db";
import { fetchJdText } from "../src/scanner/jd-fetch";
import { visaFlag } from "../src/scanner/visa-filter";

// One-time (re-runnable) JD backfill: a lot of jobs.jd_text is either empty or just the thin
// "[listing metadata] ..." marker github_lists leaves behind when it never got a rich ATS
// record for that fingerprint. This walks the queue (status='matched' applications whose job
// still has thin/empty jd_text), fetches the live apply_url, and stores whatever real posting
// text it finds.
//
// It ALSO re-runs the deterministic visa hard filter (visaFlag) against the freshly fetched
// text — same logic runScan applies at insert time — so a posting that turns out to say "we
// cannot sponsor visas" gets caught even though the original thin scrape never had that text.
// A newly-flagged job's still-open application gets archived, mirroring backfill-locations.ts.
//
// Deliberately does NOT touch degree/YoE filtering or trigger any LLM re-scoring — those are
// matcher concerns for *future* scoring only, per the "don't re-score existing matches" decision.
//
// Sequential (one request at a time) with a 300ms pause between requests, and a per-domain
// circuit breaker: 3 consecutive failures from the same host skip the rest of that host's jobs
// for this run, so one dead ATS domain doesn't burn the whole ~25-30 min budget on retries that
// will never succeed.

const DELAY_MS = 300;
const BREAKER_THRESHOLD = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function main() {
  const db = getDb();

  const jobs = db
    .prepare(
      `SELECT j.id, j.apply_url
       FROM jobs j
       JOIN applications a ON a.job_id = j.id
       WHERE a.status = 'matched' AND (j.jd_text = '' OR j.jd_text LIKE '[listing metadata]%')
       ORDER BY j.id`
    )
    .all() as { id: number; apply_url: string | null }[];

  const setJdText = db.prepare("UPDATE jobs SET jd_text = ? WHERE id = ?");
  const setVisaFlag = db.prepare("UPDATE jobs SET visa_flag = ? WHERE id = ?");
  const archiveApp = db.prepare(
    "UPDATE applications SET status = 'archived' WHERE job_id = ? AND status IN ('discovered','matched')"
  );
  const setSkipReason = db.prepare(
    "UPDATE matches SET skip_reason = 'visa (jd backfill)' WHERE job_id = ? AND skip_reason IS NULL"
  );

  let fetchedOk = 0;
  let failed = 0;
  let newlyFlagged = 0;
  let archived = 0;
  let skippedByBreaker = 0;

  const consecutiveFailsByHost = new Map<string, number>();
  const brokenHosts = new Set<string>();
  const failsByHost = new Map<string, number>();

  console.log(`backfill-jd: ${jobs.length} jobs to process`);

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (i > 0 && i % 100 === 0) {
      console.log(
        `  progress: ${i}/${jobs.length} (ok=${fetchedOk} failed=${failed} newlyFlagged=${newlyFlagged} archived=${archived} breakerSkipped=${skippedByBreaker})`
      );
    }

    if (!job.apply_url) {
      failed++;
      continue;
    }
    const host = hostOf(job.apply_url);
    if (host && brokenHosts.has(host)) {
      skippedByBreaker++;
      continue;
    }

    const text = await fetchJdText(job.apply_url);

    if (text === null) {
      failed++;
      if (host) {
        const n = (consecutiveFailsByHost.get(host) ?? 0) + 1;
        consecutiveFailsByHost.set(host, n);
        failsByHost.set(host, (failsByHost.get(host) ?? 0) + 1);
        if (n >= BREAKER_THRESHOLD) brokenHosts.add(host);
      }
    } else {
      fetchedOk++;
      if (host) consecutiveFailsByHost.set(host, 0);
      setJdText.run(text, job.id);

      const flag = visaFlag(text);
      if (flag) {
        newlyFlagged++;
        setVisaFlag.run(flag, job.id);
        const archiveInfo = archiveApp.run(job.id);
        archived += archiveInfo.changes;
        setSkipReason.run(job.id);
      }
    }

    if (i < jobs.length - 1) await sleep(DELAY_MS);
  }

  const summary = { fetchedOk, failed, skippedByBreaker, newlyFlagged, archived, total: jobs.length };
  logEvent(db, "backfill_jd_done", { entity: "backfill-jd", payload: summary });

  const newQueueSize = (
    db.prepare(`SELECT COUNT(*) n FROM applications WHERE status = 'matched'`).get() as { n: number }
  ).n;

  const topFailDomains = [...failsByHost.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  console.log("backfill-jd done:");
  console.log(`  total candidates: ${jobs.length}`);
  console.log(`  fetched OK: ${fetchedOk}`);
  console.log(`  failed: ${failed}`);
  console.log(`  skipped by circuit breaker: ${skippedByBreaker}`);
  console.log(`  visa newly-flagged: ${newlyFlagged}`);
  console.log(`  applications archived: ${archived}`);
  console.log(`  new queue size (applications.status='matched'): ${newQueueSize}`);
  console.log(`  top failure domains:`);
  for (const [host, n] of topFailDomains) console.log(`    ${host}: ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
