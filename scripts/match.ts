import { getDb } from "../src/lib/db";
import { loadProfile } from "../src/lib/profile";
import { getBackend } from "../src/llm/registry";
import { runMatching } from "../src/matcher/run";

export interface MatchArgs {
  limit?: number;
  rescoreArchived: boolean;
  concurrency: number;
  rescoreMatched: boolean;
}

// Pure argv parser (exported for unit testing): accepts an optional numeric limit (jobs scored
// per pass) as any bare non-flag arg, an optional --rescore-archived flag, an optional
// --rescore-matched flag, and an optional --concurrency N flag (default 6), in any order.
export function parseMatchArgs(argv: string[]): MatchArgs {
  let limit: number | undefined;
  let rescoreArchived = false;
  let concurrency = 6;
  let rescoreMatched = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--rescore-archived") {
      rescoreArchived = true;
      continue;
    }
    if (arg === "--rescore-matched") {
      rescoreMatched = true;
      continue;
    }
    if (arg === "--concurrency") {
      const n = Number(argv[i + 1]);
      if (!Number.isNaN(n)) concurrency = n;
      i++;
      continue;
    }
    const n = Number(arg);
    if (arg.trim() !== "" && !Number.isNaN(n)) limit = n;
  }
  return { limit, rescoreArchived, concurrency, rescoreMatched };
}

const MAX_ITERATIONS = 60;

async function main() {
  const { limit, rescoreArchived, concurrency, rescoreMatched } = parseMatchArgs(process.argv.slice(2));
  const db = getDb();
  const profile = loadProfile();
  const backend = getBackend();

  const totals = { scored: 0, matched: 0, archived: 0, errors: 0, durationMs: 0 };
  let iteration = 0;

  // runMatching only scores jobs without a match row yet (resumable), so looping converges:
  // a pass that scores 0 jobs means every eligible job now has a match row. This guards
  // against a model that omits jobs from a batch response — an omitted job just gets picked
  // up again on the next pass instead of silently staying unscored forever.
  for (;;) {
    iteration++;
    const summary = await runMatching(db, {
      backend,
      profile: { directions: profile.directions, work_auth: profile.work_auth },
      batchSize: 10,
      threshold: 40,
      limit,
      rescoreArchived,
      concurrency,
      rescoreMatched,
    });
    console.log(
      `pass ${iteration}: scored ${summary.scored}, matched ${summary.matched}, archived ${summary.archived}, ${summary.errors.length} errors, ${summary.durationMs}ms`
    );
    for (const e of summary.errors.slice(0, 5)) console.error(`  batch ${e.batch}: ${e.error}`);

    totals.scored += summary.scored;
    totals.matched += summary.matched;
    totals.archived += summary.archived;
    totals.errors += summary.errors.length;
    totals.durationMs += summary.durationMs;

    // Archived jobs already carry a match row, so a rescore pass never naturally converges to
    // scored===0 the way fresh jobs do — one full pass is the intended behavior here. Same for
    // rescoreMatched (already-'matched' rows also always carry a match row).
    if (rescoreArchived || rescoreMatched) break;
    if (summary.scored === 0) break;
    if (iteration >= MAX_ITERATIONS) break;
  }

  console.log(
    `match total: scored ${totals.scored} (matched ${totals.matched}, archived ${totals.archived}), ${totals.errors} batch errors, ${totals.durationMs}ms across ${iteration} pass(es)`
  );
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
