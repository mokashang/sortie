import { getDb } from "../src/lib/db";
import { getBackend } from "../src/llm/registry";
import { runConsolidate, pendingGroupKeys } from "../src/scanner/consolidate";

async function main() {
  const db = getDb();
  const backend = getBackend();
  for (let pass = 1; pass <= 20; pass++) {
    const before = pendingGroupKeys(db).length;
    if (before === 0) break;
    const s = await runConsolidate(db, { backend, groupsPerCall: 15 });
    console.log(`pass ${pass}: ${before} pending → judged ${s.groups} groups, ${s.clusters} clusters, archived ${s.archived}, ${s.errors.length} errors (${s.durationMs}ms)`);
    for (const e of s.errors.slice(0, 3)) console.error("  " + e);
    if (s.groups === 0) break; // nothing judged this pass (all errors) — stop instead of looping forever
  }
  console.log(`remaining pending groups: ${pendingGroupKeys(db).length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
