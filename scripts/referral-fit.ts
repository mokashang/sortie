import { getDb } from "../src/lib/db";
import { getBackend } from "../src/llm/registry";
import { runReferralFit, countUnclassified } from "../src/matcher/referral-fit";
import { resolveScriptUser } from "./script-user";

// npm run referral-fit [limit] [--concurrency N] — classify every queued (matched) job that has
// no referral_fit yet as 建议内推 / 海投. Resumable: each pass only touches unclassified rows.
function parseArgs(argv: string[]): { limit?: number; concurrency: number; user?: string } {
  let limit: number | undefined;
  let concurrency = 4;
  let user: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user") {
      user = argv[i + 1];
      i++;
      continue;
    }
    if (argv[i] === "--concurrency") {
      const n = Number(argv[i + 1]);
      if (!Number.isNaN(n)) concurrency = n;
      i++;
      continue;
    }
    const n = Number(argv[i]);
    if (argv[i].trim() !== "" && !Number.isNaN(n)) limit = n;
  }
  return { limit, concurrency, user };
}

async function main() {
  const { limit, concurrency, user } = parseArgs(process.argv.slice(2));
  const db = getDb();
  const account = resolveScriptUser(db, user);
  console.log(`classifying as ${account.email}; unclassified before: ${countUnclassified(db, account.id)}`);
  for (let pass = 1; pass <= 20; pass++) {
    const s = await runReferralFit(db, { userId: account.id, backend: getBackend(), batchSize: 40, limit, concurrency });
    console.log(
      `pass ${pass}: classified ${s.classified} (referral ${s.referral}, direct ${s.direct}), ${s.errors.length} errors, ${s.durationMs}ms`
    );
    for (const e of s.errors.slice(0, 5)) console.error(`  batch ${e.batch}: ${e.error}`);
    if (s.classified === 0 || limit) break;
  }
  console.log(`unclassified after: ${countUnclassified(db, account.id)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
