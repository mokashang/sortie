import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runTick } from "@/scanner/scheduler";
import { startPostScanPipeline, unscoredBacklog, matchBudget } from "@/scanner/relay";
import { retierAll } from "@/scanner/retier";

let tickInFlight = false;
let lastRetierDay = "";

// 每分钟由 instrumentation.ts 调一次:问到期板块;有新增、或有积压且本小时打分额度未用完就接力;
// 每天本地 03:xx 重算一次分级。同一进程内不重入。
export async function POST() {
  if (tickInFlight) return NextResponse.json({ skipped: "tick in flight" });
  tickInFlight = true;
  try {
    const db = getDb();
    const now = new Date();
    const day = now.toDateString();
    let retier: { changed: number } | null = null;
    if (now.getHours() === 3 && lastRetierDay !== day) {
      lastRetierDay = day;
      retier = retierAll(db, now);
    }
    const summary = await runTick(db, { now });
    let pipeline = false;
    if ((summary.inserted > 0 || unscoredBacklog(db) > 0) && matchBudget(db) > 0) pipeline = startPostScanPipeline(db);
    return NextResponse.json({ ...summary, pipeline, retier });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  } finally {
    tickInFlight = false;
  }
}
