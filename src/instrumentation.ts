// Zero-import scheduler: dev's webpack edge-runtime compile statically follows any (even
// dynamic) import reachable from register() — including into better-sqlite3's native
// require('fs') — and fails to build, since production's minifier is the only thing that dead-
// code-eliminates the NEXT_RUNTIME guard before webpack tries to resolve those imports. Keeping
// this module import-free sidesteps that entirely: the actual scan logic lives behind
// /api/scan/tick, reached here only via fetch(), so nothing node-only is ever in this module's graph.
//
// 2026-09-06:从"每天 7:00 / 13:00 两次"改为"每分钟一跳"。tick 自己决定该问谁(boards 表的到期时间:
// core 每小时、longtail 每天、dormant 每周),没到期就什么都不做,所以每分钟敲一次很便宜。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as { __jobseekerCron?: boolean };
  if (g.__jobseekerCron) return; // HMR guard: don't stack up timers across dev Fast Refresh
  g.__jobseekerCron = true;
  const port = process.env.PORT || "3000";
  setInterval(() => {
    fetch(`http://127.0.0.1:${port}/api/scan/tick`, { method: "POST" }).catch((e) => console.error("[scan tick]", e));
  }, 60_000);
  console.log("[jobseeker] scheduler registered: scan tick every 60s (in-process timer)");
}
