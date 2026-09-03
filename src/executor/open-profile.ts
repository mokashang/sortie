import { spawn as nodeSpawn } from "child_process";
import fs from "fs";
import path from "path";

// "Login once" affordance: POST /api/executor/open-profile (src/app/api/executor/open-profile/
// route.ts) calls this to spawn a headed Chrome window on the SAME persistent profile dir the
// headless Playwright MCP executor drives (data/browser-profile — see the `playwright` MCP
// server registered via `claude mcp add --scope user`). The user logs into LinkedIn/Workday/etc.
// once in that window; the session persists on disk so unattended `claude -p` executor runs see
// it as already-logged-in.
//
// Deliberately does NOT go through `npx @playwright/mcp` — that starts an MCP server, not a
// plain browser window for a human to click around in. Spawns the Chrome binary directly instead,
// falling back to `open -na "Google Chrome" --args ...` (Launch Services app-name resolution) if
// the .app isn't at the usual path.

const CHROME_APP_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// A structural subset of child_process.ChildProcess — mirrors the pattern in executor/runner.ts
// so tests can inject a fake without touching the real filesystem/process table.
export interface SpawnedChild {
  pid?: number;
  unref(): void;
}

export type SpawnFn = (
  bin: string,
  args: string[],
  opts: { detached: boolean; stdio: "ignore" }
) => SpawnedChild;

export interface OpenProfileDeps {
  spawn?: SpawnFn;
  existsSync?: (p: string) => boolean;
  profileDir?: string;
}

export interface OpenProfileResult {
  bin: string;
  args: string[];
  pid: number | undefined;
}

export function openBrowserProfile(deps: OpenProfileDeps = {}): OpenProfileResult {
  const spawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const existsSync = deps.existsSync ?? fs.existsSync;
  const profileDir = deps.profileDir ?? path.join(process.cwd(), "data/browser-profile");

  let bin: string;
  let args: string[];
  if (existsSync(CHROME_APP_BIN)) {
    bin = CHROME_APP_BIN;
    args = [`--user-data-dir=${profileDir}`, "--no-first-run"];
  } else {
    bin = "open";
    args = ["-na", "Google Chrome", "--args", `--user-data-dir=${profileDir}`, "--no-first-run"];
  }

  const child = spawnFn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();

  return { bin, args, pid: child.pid };
}
