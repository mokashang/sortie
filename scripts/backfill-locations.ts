import { getDb } from "../src/lib/db";
import { locFlag } from "../src/scanner/location-filter";

// One-time (re-runnable) backfill for the US-only location hard filter: schema v5 added
// jobs.loc_flag, but every job inserted before this feature shipped has loc_flag still NULL —
// this walks the existing table, computes the flag the same way runScan now does at insert
// time, and then propagates the consequence through applications/matches exactly like a normal
// scan would have: a loc-flagged job's still-open application gets archived (mirrors what the
// matcher does for a visa-flagged job it would have skipped), and its match row (if any) gets a
// skip_reason so the reason is visible wherever skip_reason is already surfaced.
//
// Safe to run more than once: everything here is keyed off loc_flag/skip_reason state, so a
// second run only touches jobs whose location text somehow changed since the first pass.

async function main() {
  const db = getDb();

  const jobs = db.prepare("SELECT id, location FROM jobs").all() as {
    id: number;
    location: string | null;
  }[];

  const setLocFlag = db.prepare("UPDATE jobs SET loc_flag = ? WHERE id = ?");
  const archiveApp = db.prepare(
    "UPDATE applications SET status = 'archived' WHERE job_id = ? AND status IN ('discovered','matched')"
  );
  const setSkipReason = db.prepare(
    "UPDATE matches SET skip_reason = 'non-US location' WHERE job_id = ? AND skip_reason IS NULL"
  );

  let flagged = 0;
  let archived = 0;
  let skipReasonsSet = 0;

  const tx = db.transaction(() => {
    for (const job of jobs) {
      const flag = locFlag(job.location);
      if (!flag) continue;
      setLocFlag.run(flag, job.id);
      flagged++;
      const archiveInfo = archiveApp.run(job.id);
      archived += archiveInfo.changes;
      const skipInfo = setSkipReason.run(job.id);
      skipReasonsSet += skipInfo.changes;
    }
  });
  tx();

  const newQueueSize = (
    db
      .prepare(
        `SELECT COUNT(*) n FROM applications a JOIN jobs j ON j.id = a.job_id
         WHERE a.status = 'matched' AND j.loc_flag IS NULL`
      )
      .get() as { n: number }
  ).n;

  console.log(`backfill-locations done: scanned ${jobs.length} jobs`);
  console.log(`  flagged ${flagged} jobs as loc_flag='non_us'`);
  console.log(`  archived ${archived} applications (previously discovered/matched)`);
  console.log(`  set skip_reason on ${skipReasonsSet} match rows`);
  console.log(`  new queue size (status='matched' AND loc_flag IS NULL): ${newQueueSize}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
