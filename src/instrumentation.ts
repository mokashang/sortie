export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const cron = (await import("node-cron")).default;
  const { getDb } = await import("@/lib/db");
  const { runScan } = await import("@/scanner/run");
  const { syncWatchlist } = await import("@/scanner/watchlist");
  const { notify } = await import("@/lib/notify");
  const seed = (await import("../config/watchlist.seed.json")).default;

  cron.schedule("0 7,13 * * *", async () => {
    try {
      const db = getDb();
      syncWatchlist(db, seed as never);
      const s = await runScan(db);
      if (s.inserted > 0) {
        await notify("JobSeeker OS 扫描完成", `新增 ${s.inserted} 个职位(${s.visaSkipped} 个签证不符已标记)`);
      }
    } catch (e) {
      console.error("[cron scan]", e);
    }
  });
  console.log("[jobseeker] cron registered: scan at 07:00 & 13:00");
}
