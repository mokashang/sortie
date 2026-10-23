import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "@/lib/db";
import { saveSpawns } from "@/executor/sessions";
import {
  planChromeRefresh,
  maybeRefreshChrome,
  resetChromeRefreshState,
  RefreshInput,
  CHROME_IDLE_MS,
  CHROME_REFRESH_EVERY_MS,
  HEAVY_RENDERERS,
} from "@/executor/chrome-refresh";

// The job-search Chrome is restarted only when nobody is using it and it is heavy (user, 2026-10-22).

const H = 3_600_000;
const idle: RefreshInput = {
  enabled: true,
  sessions: 0,
  liveRuns: 0,
  desktopHeartbeat: false,
  lastRunEndedMsAgo: 2 * H,
  lastRefreshMsAgo: null,
  stats: { processes: 30, renderers: 25, totalMb: 1500 },
};

describe("planChromeRefresh", () => {
  it("idle and heavy → restart", () => {
    expect(planChromeRefresh(idle).refresh).toBe(true);
  });

  it("never while anything could be using it, or too soon, or when it is light", () => {
    expect(planChromeRefresh({ ...idle, enabled: false }).refresh).toBe(false);
    expect(planChromeRefresh({ ...idle, sessions: 1 }).refresh).toBe(false);
    expect(planChromeRefresh({ ...idle, liveRuns: 1 }).refresh).toBe(false);
    expect(planChromeRefresh({ ...idle, desktopHeartbeat: true }).refresh).toBe(false);
    expect(planChromeRefresh({ ...idle, lastRunEndedMsAgo: CHROME_IDLE_MS - 1 }).refresh).toBe(false);
    expect(planChromeRefresh({ ...idle, lastRefreshMsAgo: CHROME_REFRESH_EVERY_MS - 1 }).refresh).toBe(false);
    expect(planChromeRefresh({ ...idle, lastRefreshMsAgo: CHROME_REFRESH_EVERY_MS }).refresh).toBe(true);
    expect(planChromeRefresh({ ...idle, stats: null }).refresh).toBe(false);
    expect(planChromeRefresh({ ...idle, stats: { processes: 8, renderers: HEAVY_RENDERERS - 1, totalMb: 600 } }).refresh).toBe(false);
  });
});

describe("maybeRefreshChrome", () => {
  beforeEach(() => resetChromeRefreshState());

  it("measures only when everything else allows it, restarts once, then waits six hours", async () => {
    const db = openDb(":memory:");
    let measured = 0;
    let restarted = 0;
    const deps = {
      now: Date.parse("2026-10-23T10:00:00Z"),
      platform: "win32" as const,
      env: {},
      stats: () => {
        measured++;
        return { processes: 30, renderers: 25, totalMb: 1500 };
      },
      restart: async () => {
        restarted++;
        return { ok: true, how: "test" };
      },
    };
    // A session is alive: not even measured.
    saveSpawns(db, [{ pid: 1, runId: 1, startedAt: "2026-10-23T09:00:00Z", logPath: "x" }]);
    expect(maybeRefreshChrome(db, deps).refresh).toBe(false);
    expect(measured).toBe(0);

    saveSpawns(db, []);
    expect(maybeRefreshChrome(db, deps).refresh).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect([measured, restarted]).toEqual([1, 1]);

    resetChromeRefreshState();
    expect(maybeRefreshChrome(db, { ...deps, now: deps.now + CHROME_REFRESH_EVERY_MS - 1 }).reason).toBe("refreshed recently");
    expect(measured).toBe(1);
  });

  it("off on other platforms and with CHROME_REFRESH_DISABLED=1", () => {
    const db = openDb(":memory:");
    expect(maybeRefreshChrome(db, { platform: "darwin", stats: () => null }).reason).toBe("disabled");
    expect(maybeRefreshChrome(db, { platform: "win32", env: { CHROME_REFRESH_DISABLED: "1" }, stats: () => null }).reason).toBe("disabled");
  });
});
