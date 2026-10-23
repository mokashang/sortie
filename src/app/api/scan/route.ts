import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runScan } from "@/scanner/run";
import { startPostScanPipeline } from "@/scanner/relay";
import { withUser } from "@/lib/actor";

// 「立即扫描」按钮:核心层 + 清单立刻问一遍。扫描不再通知(2026-09-06 用户决定:后台例行、结果直接进队列)。
// 日常轮询由 /api/scan/tick 每分钟驱动。岗位是公共数据,任何账号都可以触发。
// One sweep at a time: a second click (or a second account) while one runs joins the same sweep
// instead of starting another 10-minute pass over the same boards (two at once only earn 429s
// from the boards both are asking). The response comes back at once (2026-10-22): a sweep takes
// ten minutes or more, and the menu used to sit on 扫描中… that long behind a toast promising
// one to three; new jobs reach the queue through the scoring pipeline on their own anyway.
let inFlight: Promise<Awaited<ReturnType<typeof runScan>>> | null = null;

export const POST = withUser(async () => {
  const db = getDb();
  const joined = inFlight != null;
  if (!inFlight) {
    inFlight = runScan(db)
      .then((summary) => {
        if (summary.inserted > 0) startPostScanPipeline(db);
        return summary;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  inFlight.catch((e) => console.error("[scan] sweep failed", e));
  return NextResponse.json({ started: true, joined });
});
