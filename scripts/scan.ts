import { getDb } from "../src/lib/db";
import { syncWatchlist, SeedCompany } from "../src/scanner/watchlist";
import { runScan } from "../src/scanner/run";
import seed from "../config/watchlist.seed.json";

async function main() {
  const db = getDb();
  syncWatchlist(db, seed as SeedCompany[]);
  const s = await runScan(db);
  console.log(
    `scan done: +${s.inserted} new, ${s.duplicates} dup, ${s.visaSkipped} visa-flagged, ${s.sourceErrors.length} source errors`
  );
  for (const e of s.sourceErrors) console.error(`  [${e.source}] ${e.error}`);
}
main();
