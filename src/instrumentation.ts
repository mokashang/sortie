// Zero-import scheduler: dev's webpack edge-runtime compile statically follows any (even
// dynamic) import reachable from register() — including into better-sqlite3's native
// require('fs') — and fails to build, since production's minifier is the only thing that dead-
// code-eliminates the NEXT_RUNTIME guard before webpack tries to resolve those imports. Keeping
// this module import-free sidesteps that entirely: the actual scan logic lives behind
// /api/scan/tick, reached here only via fetch(), so nothing node-only is ever in this module's graph.
// Node builtins needed here (reading the internal token) come from process.getBuiltinModule,
// which no bundler can follow — the same trick attended-win.ts uses for `module`.
//
// 2026-09-06:从"每天 7:00 / 13:00 两次"改为"每分钟一跳"。tick 自己决定该问谁(boards 表的到期时间:
// core 每小时、longtail 每天、dormant 每周),没到期就什么都不做,所以每分钟敲一次很便宜。
// 2026-09-13:tick / dispatch 路由只认内部令牌(spec accounts §2),每次调用都带上。

type NodeFs = { readFileSync: (p: string, enc: string) => string; existsSync: (p: string) => boolean; mkdirSync: (p: string, o: { recursive: boolean }) => void; writeFileSync: (p: string, d: string, o: { mode: number }) => void };
type NodePath = { join: (...parts: string[]) => string; dirname: (p: string) => string };
type NodeCrypto = { randomBytes: (n: number) => { toString: (enc: string) => string } };

function builtin<T>(name: string): T {
  const get = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  if (typeof get === "function") return get(`node:${name}`) as T;
  // Older Node: the eval keeps webpack from seeing a require() it would try to resolve.
  return (0, eval)("require")(name) as T;
}

// Same rule as src/lib/internal-token.ts (kept in sync by hand — that module cannot be imported
// here): env wins, else the token file, else generate one so the first boot works unattended.
function internalToken(): string {
  const fromEnv = process.env.SORTIE_INTERNAL_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const fs = builtin<NodeFs>("fs");
  const path = builtin<NodePath>("path");
  const file = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "internal-token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (t.length >= 32) return t;
  } catch {
    /* generate below */
  }
  const fresh = `sortie_internal_${builtin<NodeCrypto>("crypto").randomBytes(24).toString("base64url")}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
  return fresh;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SCAN_TICK_DISABLED) { console.log("[jobseeker] scan tick disabled by SCAN_TICK_DISABLED"); return; }
  const g = globalThis as { __jobseekerCron?: boolean };
  if (g.__jobseekerCron) return; // HMR guard: don't stack up timers across dev Fast Refresh
  g.__jobseekerCron = true;
  const port = process.env.PORT || "3000";
  const headers = { authorization: `Bearer ${internalToken()}` };
  setInterval(() => {
    fetch(`http://127.0.0.1:${port}/api/scan/tick`, { method: "POST", headers }).catch((e) => console.error("[scan tick]", e));
    // Referral-conversation monitor: the route itself only acts at 09:xx / 18:xx local.
    fetch(`http://127.0.0.1:${port}/api/referral/tick`, { method: "POST", headers }).catch((e) => console.error("[referral tick]", e));
  }, 60_000);
  // Attended-session dispatcher: spawns the selected CLI agent for queued user_chrome runs
  // when no desktop session is heartbeating (see src/executor/attended.ts). Cheap when idle.
  if (!process.env.ATTENDED_DISPATCH_DISABLED) {
    setInterval(() => {
      fetch(`http://127.0.0.1:${port}/api/executor/dispatch`, { method: "POST", headers }).catch((e) => console.error("[attended dispatch]", e));
    }, 10_000);
  }
  console.log("[jobseeker] scheduler registered: scan tick every 60s, attended dispatch every 10s (in-process timers)");
}
