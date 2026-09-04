import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runScan } from "@/scanner/run";
import { syncWatchlist } from "@/scanner/watchlist";
import { notify } from "@/lib/notify";
import { tryAcquireMatching, releaseMatching } from "@/matcher/inflight";
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

  // Fire-and-forget incremental matching: after a scan that found new jobs, this incrementally
  // scores up to 200 currently-unscored jobs (any job with no `matches` row yet — resumable across
  // scans, not just the ones this particular scan inserted). Deliberately NOT awaited: each LLM
  // batch takes ~35s and a full pass (limit 200) could take minutes — awaiting it here would hang
  // the HTTP response well past any reasonable client/cron timeout. `db` is the process-wide
  // getDb() singleton, so it's safe to keep using after the response is sent (the Next.js process
  // stays alive). The .catch guards against an unhandled rejection crashing the server if matching
  // fails after the response has already gone out. `tryAcquireMatching()` is a process-wide lock
  // (shared with the jd_review finish chain in executor/finish/route.ts) that prevents an
  // overlapping trigger (cron and manual can race, or a jd_review run finishing mid-scan) from
  // starting a second concurrent matching pass over the same unscored jobs while one is already
  // running.
  if (summary.inserted > 0 && tryAcquireMatching()) {
    void (async () => {
      try {
        const { loadProfile } = await import("@/lib/profile");
        const { getBackend } = await import("@/llm/registry");
        const { runConsolidate } = await import("@/scanner/consolidate");
        const { runMatching } = await import("@/matcher/run");
        const { maybeStartJdReview } = await import("@/jd-review/relay");
        const profile = loadProfile();
        const backend = getBackend();
        // 顺序固定:先去重(重复行不进匹配),再匹配,最后补正文接力。
        // limitGroups bounds per-scan LLM spend; `npm run consolidate` drains any backlog beyond this.
        const c = await runConsolidate(db, { backend, groupsPerCall: 15, limitGroups: 20 });
        console.log(`[scan→consolidate] groups ${c.groups}, archived ${c.archived}, errors ${c.errors.length}`);
        await runMatching(db, {
          backend,
          profile: { directions: profile.directions, work_auth: profile.work_auth },
          batchSize: 10,
          threshold: 40,
          limit: 200,
          concurrency: 6,
        });
        const relay = maybeStartJdReview(db);
        console.log("[scan→jd_review]", relay);
      } catch (e) {
        console.error("[scan→match]", e);
      } finally {
        releaseMatching();
      }
    })().catch((e) => {
      console.error("[scan→match] unhandled", e);
    });
  }

  return NextResponse.json(summary);
}
