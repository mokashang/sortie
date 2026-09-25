import { spawn as nodeSpawn } from "child_process";
import fs from "fs";
import path from "path";
import { browserProfileDir } from "@/executor/mcp-config";

// "Login once" affordance: POST /api/executor/open-profile (src/app/api/executor/open-profile/
// route.ts) calls this to spawn a headed Chrome window on the SAME persistent profile dir the
// headless Playwright MCP executor drives (data/browser-profile — the `playwright` MCP server the
// executor registers inline, see src/executor/mcp-config.ts). The user logs into LinkedIn/Workday/etc.
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
  opts: { detached: boolean; stdio: "ignore"; windowsHide?: boolean }
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
  const profileDir = deps.profileDir ?? browserProfileDir();
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

  const child = spawnFn(bin, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();

  return { bin, args, pid: child.pid };
}

// The job-search Chrome profile on this machine — the one the attended session drives (Windows
// Profile 4, ops/windows/start-chrome.cmd). CHROME_JOB_PROFILE overrides the folder name.
export function jobChromeProfile(env: Record<string, string | undefined> = process.env): string {
  return env.CHROME_JOB_PROFILE?.trim() || "Profile 4";
}

// 「全部去登录」 on the 待处理 tab: open every blocked sign-in page as tabs of the user's own
// job-search Chrome on the server machine (an already-running Chrome just adds the tabs), so the
// session lands where the assistant fills forms — not in whatever browser the App is viewed from.
// The user does the signing in; this only opens pages. Only http(s) URLs are passed through.
export function openUrlsInJobChrome(urls: string[], deps: Omit<OpenProfileDeps, "profileDir"> = {}): OpenProfileResult {
  const spawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const existsSync = deps.existsSync ?? fs.existsSync;
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const safe = urls.filter((u) => /^https?:\/\//i.test(u));
  if (safe.length === 0) throw new Error("openUrlsInJobChrome: no http(s) urls");
  const profile = `--profile-directory=${jobChromeProfile(env)}`;

  const found = env.CHROME_BIN || chromeCandidates(platform, env).find((c) => existsSync(c));
  let bin: string;
  let args: string[];
  if (found) {
    bin = found;
    args = [profile, ...safe];
  } else if (platform === "darwin") {
    bin = "open";
    args = ["-na", "Google Chrome", "--args", profile, ...safe];
  } else if (platform === "win32") {
    // No `cmd /c start` fallback here: cmd would parse the `&` in a query string as a separator.
    throw new Error("Chrome not found (set CHROME_BIN)");
  } else {
    bin = "google-chrome";
    args = [profile, ...safe];
  }

  const child = spawnFn(bin, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return { bin, args, pid: child.pid };
}
