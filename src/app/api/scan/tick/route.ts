import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runTick } from "@/scanner/scheduler";
import { startPostScanPipeline, unscoredBacklog, matchBudget } from "@/scanner/relay";
import { retierAll } from "@/scanner/retier";
import { withInternal } from "@/lib/actor";

let tickInFlight = false;
let lastRetierDay = "";

// 每分钟由 instrumentation.ts 调一次(带内部令牌):问到期板块;有新增、或有积压且本小时打分额度未用完就接力;
// 每天本地 03:xx 重算一次分级。同一进程内不重入。
// 一跳常常要几分钟(Workday 一个板块就要逐条取详情),比调用方 fetch 的 300 秒等头超时还长——
// 2026-10-16 之前错误日志里每隔几分钟一条 HeadersTimeoutError。所以这里立刻回 202,扫描在后台跑完,
// 结果照旧写进 events(scan_tick)。
export const POST = withInternal(async () => {
  if (tickInFlight) return NextResponse.json({ skipped: "tick in flight" });
  tickInFlight = true;
  const work = (async () => {
    const db = getDb();
    const now = new Date();
    const day = now.toDateString();
    if (now.getHours() === 3 && lastRetierDay !== day) {
      lastRetierDay = day;
      retierAll(db, now);
    }
    // 先让打分动起来:有积压就立刻接力,不等这一跳(首次铺开时一跳可能跑几分钟)结束。
    let pipeline = false;
    if (unscoredBacklog(db) > 0 && matchBudget(db) > 0) pipeline = startPostScanPipeline(db);
    const summary = await runTick(db, { now });
    if (!pipeline && summary.inserted > 0 && matchBudget(db) > 0) startPostScanPipeline(db);
  })();
  work
    .catch((e) => console.error("[scan tick]", e))
    .finally(() => {
      tickInFlight = false;
    });
  return NextResponse.json({ started: true }, { status: 202 });
});
