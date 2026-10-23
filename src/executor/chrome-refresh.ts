import { spawn, spawnSync } from "child_process";
import { DB, logEvent } from "@/lib/db";
import { listSpawns } from "@/executor/sessions";

// The job-search Chrome's memory is the system's job, not the user's (user, 2026-10-22: "chrome内存
// 应该由claude自动管理"). Sessions close their own tabs as they go and before they are shut down
// (tabs.ts, attended.ts shutdownNotice), but a session that crashed or was killed by a deploy
// leaves its tab group behind, and no later session can reach it: each one only sees its own
// group. The only way to clear those is to restart Chrome. Profile 4 does not restore the last
// session on startup, so a restart opens clean, with every site login kept.
//
// So when the assistants are idle — no spawned session alive, no attended run running or queued,
// no desktop session heartbeating, the last attended run ended a while ago — and Chrome is heavy,
// the dispatcher closes the job-search Chrome and starts it again through the "Sortie Chrome"
// logon task, at most once every CHROME_REFRESH_EVERY_MS. The user chose this on 2026-10-22,
// knowing it closes every Chrome window on this box. CHROME_REFRESH_DISABLED=1 turns it off.

export const CHROME_REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;
// Quiet time after the last attended run before Chrome counts as unused.
export const CHROME_IDLE_MS = 30 * 60 * 1000;
// How often the dispatcher measures Chrome at all (a PowerShell call, so not every 10 s tick).
export const CHROME_MEASURE_EVERY_MS = 10 * 60 * 1000;
// "Heavy": more renderer processes than a couple of open tabs plus the extensions need, or this
// much memory in total.
export const HEAVY_RENDERERS = 12;
export const HEAVY_MB = 1200;

const REFRESHED_KEY = "chrome_refreshed_at";

export interface ChromeStats {
  processes: number;
  renderers: number;
  totalMb: number;
}

export interface RefreshInput {
  enabled: boolean; // Windows, not disabled by the env
  sessions: number; // spawned attended sessions on record
  liveRuns: number; // attended runs running or queued
  desktopHeartbeat: boolean; // a desktop session heartbeated recently
  lastRunEndedMsAgo: number | null; // null: no attended run has ended yet
  lastRefreshMsAgo: number | null; // null: never refreshed
  stats: ChromeStats | null; // null: Chrome is not running or could not be measured
}

export type RefreshDecision = { refresh: true; reason: string } | { refresh: false; reason: string };

// Pure (tests/chrome-refresh.test.ts).
export function planChromeRefresh(i: RefreshInput): RefreshDecision {
  if (!i.enabled) return { refresh: false, reason: "disabled" };
  if (i.sessions > 0) return { refresh: false, reason: `${i.sessions} assistant session(s) alive` };
  if (i.liveRuns > 0) return { refresh: false, reason: `${i.liveRuns} attended run(s) running or queued` };
  if (i.desktopHeartbeat) return { refresh: false, reason: "a desktop session is using Chrome" };
  if (i.lastRunEndedMsAgo != null && i.lastRunEndedMsAgo < CHROME_IDLE_MS) return { refresh: false, reason: "the last task ended moments ago" };
  if (i.lastRefreshMsAgo != null && i.lastRefreshMsAgo < CHROME_REFRESH_EVERY_MS) return { refresh: false, reason: "refreshed recently" };
  if (!i.stats) return { refresh: false, reason: "Chrome not running" };
  const heavy = i.stats.renderers >= HEAVY_RENDERERS || i.stats.totalMb >= HEAVY_MB;
  if (!heavy) return { refresh: false, reason: `Chrome is light (${i.stats.renderers} renderers, ${i.stats.totalMb} MB)` };
  return { refresh: true, reason: `idle and heavy: ${i.stats.renderers} renderers, ${i.stats.totalMb} MB` };
}

// Windows only: every chrome.exe process, by type and working set.
export function readChromeStats(): ChromeStats | null {
  if (process.platform !== "win32") return null;
  const ps = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$p = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\"; " +
        "@{ processes = @($p).Count; renderers = @($p | Where-Object { $_.CommandLine -match '--type=renderer' }).Count; " +
        "totalMb = [math]::Round((($p | Measure-Object WorkingSetSize -Sum).Sum) / 1MB) } | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", timeout: 20_000, windowsHide: true }
  );
  if (ps.status !== 0 || !ps.stdout) return null;
  try {
    const s = JSON.parse(ps.stdout.trim()) as ChromeStats;
    return s.processes > 0 ? { processes: s.processes, renderers: s.renderers, totalMb: s.totalMb ?? 0 } : null;
  } catch {
    return null;
  }
}

function chromeRunning(): boolean {
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq chrome.exe", "/NH"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return /chrome\.exe/i.test(r.stdout ?? "");
}

// Close Chrome the way a click on X does (taskkill without /F), give it a while to write its
// state, force what is left, then start the job-search profile again — through the logon task
// so it runs exactly as at boot, or directly if the task can't be run.
export async function restartChrome(deps: { sleep?: (ms: number) => Promise<void> } = {}): Promise<{ ok: boolean; how: string }> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  spawnSync("taskkill", ["/IM", "chrome.exe", "/T"], { windowsHide: true, timeout: 20_000 });
  for (let i = 0; i < 15 && chromeRunning(); i++) await sleep(2000);
  if (chromeRunning()) spawnSync("taskkill", ["/F", "/IM", "chrome.exe", "/T"], { windowsHide: true, timeout: 20_000 });
  await sleep(2000);
  const task = spawnSync("schtasks", ["/Run", "/TN", "Sortie Chrome"], { encoding: "utf8", windowsHide: true, timeout: 20_000 });
  if (task.status === 0) return { ok: true, how: "Sortie Chrome task" };
  const exe = process.env.CHROME_EXE || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const profile = process.env.CHROME_JOB_PROFILE || "Profile 4";
  try {
    const child = spawn(exe, [`--profile-directory=${profile}`], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return { ok: true, how: "direct launch" };
  } catch (e) {
    return { ok: false, how: `could not start Chrome: ${String(e)}` };
  }
}

const g = globalThis as unknown as { __sortieChromeMeasuredAt?: number; __sortieChromeRestarting?: boolean };

export interface RefreshDeps {
  now?: number;
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  stats?: () => ChromeStats | null;
  restart?: () => Promise<{ ok: boolean; how: string }>;
  desktopHeartbeat?: () => boolean;
}

// The dispatcher tick. Cheap checks every tick; Chrome is measured at most every
// CHROME_MEASURE_EVERY_MS and only when everything else says it may go. Never throws; the restart
// runs in the background.
export function maybeRefreshChrome(db: DB, deps: RefreshDeps = {}): RefreshDecision {
  try {
    const now = deps.now ?? Date.now();
    const env = deps.env ?? process.env;
    const enabled = (deps.platform ?? process.platform) === "win32" && env.CHROME_REFRESH_DISABLED !== "1";
    if (g.__sortieChromeRestarting) return { refresh: false, reason: "restart in progress" };
    const sessions = listSpawns(db).length;
    const liveRuns = (db.prepare("SELECT COUNT(*) n FROM executor_runs WHERE channel = 'user_chrome' AND status IN ('running','queued')").get() as { n: number }).n;
    const lastEnded = (db.prepare("SELECT MAX(ended_at) t FROM executor_runs WHERE channel = 'user_chrome'").get() as { t: string | null }).t;
    const refreshed = (db.prepare("SELECT value FROM profile WHERE key = ?").get(REFRESHED_KEY) as { value: string } | undefined)?.value ?? null;
    const ago = (t: string | null) => (t ? now - Date.parse(/[zZ]$/.test(t) ? t : t.replace(" ", "T") + "Z") : null);
    const base: RefreshInput = {
      enabled,
      sessions,
      liveRuns,
      desktopHeartbeat: deps.desktopHeartbeat ? deps.desktopHeartbeat() : false,
      lastRunEndedMsAgo: ago(lastEnded),
      lastRefreshMsAgo: ago(refreshed),
      stats: { processes: 1, renderers: HEAVY_RENDERERS, totalMb: HEAVY_MB }, // assume heavy until measured
    };
    const gate = planChromeRefresh(base);
    if (!gate.refresh) return gate;
    if (g.__sortieChromeMeasuredAt != null && now - g.__sortieChromeMeasuredAt < CHROME_MEASURE_EVERY_MS) return { refresh: false, reason: "measured recently" };
    g.__sortieChromeMeasuredAt = now;
    const decision = planChromeRefresh({ ...base, stats: (deps.stats ?? readChromeStats)() });
    if (!decision.refresh) return decision;
    db.prepare("INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(REFRESHED_KEY, new Date(now).toISOString());
    g.__sortieChromeRestarting = true;
    console.log(`[chrome] restarting the job-search Chrome: ${decision.reason}`);
    void (deps.restart ?? restartChrome)()
      .then((r) => {
        console.log(`[chrome] restart ${r.ok ? "done" : "FAILED"} (${r.how})`);
        try {
          logEvent(db, "chrome_refreshed", { payload: { reason: decision.reason, ...r } });
        } catch {
          // the event is a nicety
        }
      })
      .finally(() => {
        g.__sortieChromeRestarting = false;
      });
    return decision;
  } catch (e) {
    console.error("[chrome] refresh check failed", e);
    return { refresh: false, reason: `error: ${String(e)}` };
  }
}

// Tests only.
export function resetChromeRefreshState(): void {
  g.__sortieChromeMeasuredAt = undefined;
  g.__sortieChromeRestarting = undefined;
}
