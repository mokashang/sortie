import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runScan } from "@/scanner/run";
import { startPostScanPipeline } from "@/scanner/relay";
import { withUser } from "@/lib/actor";

// 「立即扫描」按钮:核心层 + 清单立刻问一遍。扫描不再通知(2026-09-06 用户决定:后台例行、结果直接进队列)。
// 日常轮询由 /api/scan/tick 每分钟驱动。岗位是公共数据,任何账号都可以触发。
export const POST = withUser(async () => {
  const db = getDb();
  const summary = await runScan(db);
  if (summary.inserted > 0) startPostScanPipeline(db);
  return NextResponse.json(summary);
});
