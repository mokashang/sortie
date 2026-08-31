import { getDb } from "../src/lib/db";
import { syncWatchlist } from "../src/scanner/watchlist";
import { runScan } from "../src/scanner/run";
import seed from "../config/watchlist.seed.json";

async function main() {
  const db = getDb();
  syncWatchlist(db, seed);
  const s = await runScan(db);
  console.log(
    `scan done: +${s.inserted} new, ${s.upgraded} upgraded, ${s.duplicates} dup, ${s.visaSkipped} visa-flagged, ${s.locSkipped} non-US, ${s.sourceErrors.length} source errors (${s.durationMs}ms)`
  );
  for (const e of s.sourceErrors) console.error(`  [${e.source}] ${e.error}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
