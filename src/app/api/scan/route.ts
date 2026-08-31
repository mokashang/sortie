import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runScan } from "@/scanner/run";
import { syncWatchlist } from "@/scanner/watchlist";
import { notify } from "@/lib/notify";
import seed from "../../../../config/watchlist.seed.json";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const isCron = url.searchParams.get("trigger") === "cron";

  const db = getDb();
  syncWatchlist(db, seed);
  const summary = await runScan(db);

  // Manual "立即扫描" button clicks never notify — only the in-process cron timer does, and only
  // when the scan actually found brand-new listings. Upgrades are backfills of a JD/visa flag onto
  // an already-known job (see run.ts), not a new opportunity — notifying on those alone would buzz
  // the phone daily for nothing actionable, so this deliberately ignores `upgraded`.
  if (isCron && summary.inserted > 0) {
    await notify(
      "JobSeeker OS 扫描完成",
      `新增 ${summary.inserted} 个职位,升级 ${summary.upgraded} 个(${summary.visaSkipped} 个签证不符已标记)`
    );
  }

  // Fire-and-forget incremental matching for newly-inserted jobs. Deliberately NOT awaited: each
  // LLM batch takes ~35s and a full incremental pass (limit 200) could take minutes — awaiting it
  // here would hang the HTTP response well past any reasonable client/cron timeout. `db` is the
  // process-wide getDb() singleton, so it's safe to keep using after the response is sent (the
  // Next.js process stays alive). The .catch guards against an unhandled rejection crashing the
  // server if matching fails after the response has already gone out.
  if (summary.inserted > 0) {
    void (async () => {
      try {
        const { loadProfile } = await import("@/lib/profile");
        const { getBackend } = await import("@/llm/registry");
        const { runMatching } = await import("@/matcher/run");
        const profile = loadProfile();
        await runMatching(db, {
          backend: getBackend(),
          profile: { directions: profile.directions, work_auth: profile.work_auth },
          batchSize: 10,
          threshold: 40,
          limit: 200,
          concurrency: 6,
        });
      } catch (e) {
        console.error("[scan→match]", e);
      }
    })().catch((e) => {
      console.error("[scan→match] unhandled", e);
    });
  }

  return NextResponse.json(summary);
}
