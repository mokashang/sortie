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
// the .app isn't at the usual path. Windows probes Program Files / LocalAppData (or CHROME_BIN),
// falling back to `cmd /c start chrome`.

const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Where a stock Chrome install lives per platform, most specific first. Windows paths are built
// from the environment so tests can pin them; on a real box ProgramFiles / LOCALAPPDATA always exist.
export function chromeCandidates(platform: NodeJS.Platform, env: Record<string, string | undefined>): string[] {
  if (platform === "darwin") return [MAC_CHROME];
  if (platform === "win32") {
    const rel = path.join("Google", "Chrome", "Application", "chrome.exe");
    return [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]
      .filter((d): d is string => !!d)
      .map((d) => path.join(d, rel));
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
}

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
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
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
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const userDataDir = `--user-data-dir=${profileDir}`;

  // CHROME_BIN is an explicit override and is trusted as-is (a wrong path surfaces as ENOENT).
  const found = env.CHROME_BIN || chromeCandidates(platform, env).find((c) => existsSync(c));

  let bin: string;
  let args: string[];
  if (found) {
    bin = found;
    args = [userDataDir, "--no-first-run"];
  } else if (platform === "darwin") {
    // Launch Services app-name resolution when Chrome.app isn't at the usual path.
    bin = "open";
    args = ["-na", "Google Chrome", "--args", userDataDir, "--no-first-run"];
  } else if (platform === "win32") {
    // `start` resolves `chrome` through the App Paths registry key.
    bin = "cmd";
    args = ["/c", "start", "", "chrome", userDataDir, "--no-first-run"];
  } else {
    bin = "google-chrome";
    args = [userDataDir, "--no-first-run"];
  }

  const child = spawnFn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();

  return { bin, args, pid: child.pid };
}
