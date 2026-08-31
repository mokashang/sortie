// Zero-import scheduler: dev's webpack edge-runtime compile statically follows any (even
// dynamic) import reachable from register() — including into better-sqlite3's native
// require('fs') — and fails to build, since production's minifier is the only thing that dead-
// code-eliminates the NEXT_RUNTIME guard before webpack tries to resolve those imports. Keeping
// this module import-free sidesteps that entirely: the actual scan/notify logic lives behind
// /api/scan, reached here only via fetch(), so nothing node-only is ever in this module's graph.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as { __jobseekerCron?: boolean };
  if (g.__jobseekerCron) return; // HMR guard: don't stack up timers across dev Fast Refresh
  g.__jobseekerCron = true;
  const port = process.env.PORT || "3000";
  let lastFired = "";
  setInterval(() => {
    const now = new Date();
    const stamp = `${now.toDateString()}-${now.getHours()}`;
    if ((now.getHours() === 7 || now.getHours() === 13) && lastFired !== stamp) {
      lastFired = stamp;
      fetch(`http://127.0.0.1:${port}/api/scan?trigger=cron`, { method: "POST" }).catch((e) =>
        console.error("[cron scan]", e)
      );
    }
  }, 30_000);
  console.log("[jobseeker] cron registered: scan at 07:00 & 13:00 (in-process timer)");
}
