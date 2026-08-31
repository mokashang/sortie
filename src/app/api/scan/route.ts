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

  // Manual "立即扫描" button clicks never notify — only the in-process cron timer does, and
  // only when the scan actually found something new or upgraded (see instrumentation.ts).
  if (isCron && (summary.inserted > 0 || summary.upgraded > 0)) {
    await notify(
      "JobSeeker OS 扫描完成",
      `新增 ${summary.inserted} 个职位,升级 ${summary.upgraded} 个(${summary.visaSkipped} 个签证不符已标记)`
    );
  }

  return NextResponse.json(summary);
}
