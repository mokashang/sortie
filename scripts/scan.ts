import { getDb } from "../src/lib/db";
import { runScan } from "../src/scanner/run";

// 手动扫描:核心层 + 清单立刻问一遍(与 App 的「立即扫描」相同)。
async function main() {
  const db = getDb();
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
