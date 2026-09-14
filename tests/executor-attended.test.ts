import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb } from "@/lib/db";
import {
  decide,
  recordHeartbeat,
  heartbeatAgeMs,
  dispatchAttended,
  currentSpawn,
  buildExpectScript,
  buildAttendedArgs,
  ATTENDED_ALLOWED_TOOLS,
  buildAttendedPrompt,
  attendedStatus,
  attendedSpawnModeFromEnv,
  HEARTBEAT_STALE_MS,
  REAP_GRACE_MS,
} from "@/executor/attended";
import type { WindowsSpawnOptions } from "@/executor/attended-win";
import { startExecutor, finishRun, claimNextRun } from "@/executor/runner";
import { seedOwner } from "./helpers";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

describe("attended dispatcher — decide()", () => {
  it("does nothing when nothing is queued", () => {
    expect(decide({ queuedRunId: null, heartbeatAgeMs: null, spawn: null }).action).toBe("none");
  });
  it("spawns for a queued run when there was never a heartbeat or it is stale", () => {
    expect(decide({ queuedRunId: 7, heartbeatAgeMs: null, spawn: null })).toMatchObject({ action: "spawn", runId: 7 });
    expect(decide({ queuedRunId: 7, heartbeatAgeMs: HEARTBEAT_STALE_MS + 1, spawn: null }).action).toBe("spawn");
  });
  it("defers to a live attended session (fresh heartbeat)", () => {
    expect(decide({ queuedRunId: 7, heartbeatAgeMs: 5_000, spawn: null }).action).toBe("none");
  });
  it("never spawns a second child while one is alive and its run is still going", () => {
    expect(
      decide({ queuedRunId: 9, heartbeatAgeMs: null, spawn: { pid: 1, runId: 7, ageMs: 1000, alive: true, runTerminalForMs: null } }).action
    ).toBe("none");
  });
  it("reaps a dead child, a child whose run finished > grace ago, or an over-age child", () => {
    expect(decide({ queuedRunId: null, heartbeatAgeMs: null, spawn: { pid: 1, runId: 7, ageMs: 1000, alive: false, runTerminalForMs: null } })).toMatchObject({ action: "reap", pid: 1 });
    expect(decide({ queuedRunId: null, heartbeatAgeMs: null, spawn: { pid: 1, runId: 7, ageMs: 1000, alive: true, runTerminalForMs: REAP_GRACE_MS } }).action).toBe("reap");
    expect(decide({ queuedRunId: null, heartbeatAgeMs: null, spawn: { pid: 1, runId: 7, ageMs: 1000, alive: true, runTerminalForMs: 5_000 } }).action).toBe("none");
    expect(decide({ queuedRunId: null, heartbeatAgeMs: null, spawn: { pid: 1, runId: 7, ageMs: 4 * 3600_000, alive: true, runTerminalForMs: null } }).action).toBe("reap");
  });
});

describe("attended dispatcher — heartbeat + dispatch against a db", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "attended-"));

  it("records and ages heartbeats", () => {
    const db = openDb(":memory:");
    expect(heartbeatAgeMs(db, U)).toBeNull();
    recordHeartbeat(db, U, "desktop-1", "desktop", new Date("2026-09-06T10:00:00Z"));
    expect(heartbeatAgeMs(db, U, new Date("2026-09-06T10:00:12Z"))).toBe(12_000);
  });

  it("spawns an expect-wrapped claude --chrome for a queued run, records it, then reaps after the run finishes", () => {
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    const run = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 1 }] }, { logDir }, "user_chrome");
    const spawned: { scriptPath: string; logPath: string }[] = [];
    const killed: number[] = [];
    // finishRun stamps ended_at with sqlite's real datetime('now'), so the fake clock must start
    // at real wall-clock time for the "finished N seconds ago" arithmetic to be meaningful.
    let clock = new Date();
    const deps = {
      now: () => clock,
      isAlive: () => true,
      spawnExpect: (scriptPath: string, logPath: string) => {
        spawned.push({ scriptPath, logPath });
        return { pid: 4242 };
      },
      kill: (pid: number) => {
        killed.push(pid);
      },
      claudeBin: "/fake/claude",
      logDir,
      cwd: "/fake/repo",
      platform: "darwin" as const,
    };

    const r1 = dispatchAttended(db, deps);
    expect(r1.decision).toMatchObject({ action: "spawn", runId: run.id });
    expect(spawned).toHaveLength(1);
    const script = fs.readFileSync(spawned[0].scriptPath, "utf8");
    expect(script).toContain('spawn "/fake/claude" --chrome --permission-mode dontAsk --allowedTools');
    expect(script).toContain(`sortie-run-${run.id}`);
    expect(script).toContain(`run #${run.id}`);
    expect(script).toContain("Enter to confirm");
    expect(currentSpawn(db)).toMatchObject({ pid: 4242, runId: run.id });
    expect(attendedStatus(db, U, deps).spawn).toMatchObject({ pid: 4242, alive: true });

    // Second tick while the child works: nothing happens even though the run is still queued.
    expect(dispatchAttended(db, deps).decision.action).toBe("none");

    // The child claims and finishes the run; after the grace period the dispatcher reaps it.
    expect(claimNextRun(db, U, "user_chrome")?.id).toBe(run.id);
    finishRun(db, U, run.id, "done", "ok");
    clock = new Date(clock.getTime() + 5_000);
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    clock = new Date(clock.getTime() + REAP_GRACE_MS + 1000);
    const r3 = dispatchAttended(db, deps);
    expect(r3.decision.action).toBe("reap");
    expect(killed).toEqual([4242]);
    expect(currentSpawn(db)).toBeNull();
  });

  it("does not spawn while a desktop session heartbeats", () => {
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    startExecutor(db, U, "apply", {}, { logDir }, "user_chrome");
    recordHeartbeat(db, U, "desktop-1", "desktop", new Date("2026-09-06T10:00:00Z"));
    const r = dispatchAttended(db, { now: () => new Date("2026-09-06T10:00:08Z"), spawnExpect: () => { throw new Error("must not spawn"); }, logDir, platform: "darwin" });
    expect(r.decision.action).toBe("none");
  });

  it("reaps a child that died without finishing its run, so the next tick can respawn", () => {
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    const run = startExecutor(db, U, "apply", {}, { logDir }, "user_chrome");
    let alive = true;
    const deps = { isAlive: () => alive, spawnExpect: () => ({ pid: 1 }), kill: () => {}, claudeBin: "/fake/claude", logDir, cwd: "/fake", platform: "darwin" as const };
    expect(dispatchAttended(db, deps).decision.action).toBe("spawn");
    alive = false;
    expect(dispatchAttended(db, deps).decision.action).toBe("reap");
    expect(dispatchAttended(db, deps).decision).toMatchObject({ action: "spawn", runId: run.id });
  });

  it("prompt tells the session what to do when the extension is not connected", () => {
    const p = buildAttendedPrompt(12);
    expect(p).toContain("run #12");
    expect(p).toContain("list_connected_browsers");
    expect(p).toContain("claim-next");
    expect(buildExpectScript({ claudeBin: "/c", cwd: "/w", runId: 1, prompt: 'say "hi" $x' })).toContain('say \\"hi\\" \\$x');
  });

  it("buildAttendedArgs is the single argv both launchers hand to claude", () => {
    const args = buildAttendedArgs({ runId: 3, prompt: "P" });
    expect(args).toEqual(["--chrome", "--permission-mode", "dontAsk", "--allowedTools", ...ATTENDED_ALLOWED_TOOLS, "-n", "sortie-run-3", "P"]);
    expect(buildAttendedArgs({ runId: 3, prompt: "P", sessionName: "custom" })).toContain("custom");
    const script = buildExpectScript({ claudeBin: "/c", cwd: "/w", runId: 3, prompt: "P" });
    for (const tool of ATTENDED_ALLOWED_TOOLS) expect(script).toContain(tool);
    expect(script).toContain("-n sortie-run-3");
  });

  it("on Windows hands the argv to the platform launcher instead of writing an expect script", () => {
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    const run = startExecutor(db, U, "apply", {}, { logDir }, "user_chrome");
    const calls: { mode: string; opts: WindowsSpawnOptions }[] = [];
    const deps = {
      platform: "win32" as const,
      spawnMode: "pty" as const,
      spawnWindows: (mode: "pty" | "console", opts: WindowsSpawnOptions) => {
        calls.push({ mode, opts });
        return { pid: 9 };
      },
      spawnExpect: () => {
        throw new Error("expect must not be used on win32");
      },
      claudeBin: "C:\\Users\\u\\.local\\bin\\claude.exe",
      logDir,
      cwd: "C:\\sortie",
    };
    expect(dispatchAttended(db, deps).decision.action).toBe("spawn");
    expect(calls).toHaveLength(1);
    expect(calls[0].mode).toBe("pty");
    expect(calls[0].opts.claudeBin).toBe("C:\\Users\\u\\.local\\bin\\claude.exe");
    expect(calls[0].opts.cwd).toBe("C:\\sortie");
    expect(calls[0].opts.args.slice(0, 4)).toEqual(["--chrome", "--permission-mode", "dontAsk", "--allowedTools"]);
    expect(calls[0].opts.args.at(-1)).toContain(`run #${run.id}`);
    expect(calls[0].opts.logPath).toBe(path.join(logDir, `attended-${run.id}.log`));
    expect(fs.existsSync(path.join(logDir, `attended-${run.id}.exp`))).toBe(false);
    expect(currentSpawn(db)).toMatchObject({ pid: 9, runId: run.id, logPath: path.join(logDir, `attended-${run.id}.log`) });
  });

  it("passes the console mode through to the Windows launcher", () => {
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    startExecutor(db, U, "apply", {}, { logDir }, "user_chrome");
    const modes: string[] = [];
    dispatchAttended(db, { platform: "win32", spawnMode: "console", spawnWindows: (mode) => { modes.push(mode); return { pid: 1 }; }, claudeBin: "C:\\c.exe", logDir, cwd: "C:\\s" });
    expect(modes).toEqual(["console"]);
  });

  it("reads the Windows launcher mode from ATTENDED_SPAWN_MODE (pty unless explicitly console)", () => {
    expect(attendedSpawnModeFromEnv({})).toBe("pty");
    expect(attendedSpawnModeFromEnv({ ATTENDED_SPAWN_MODE: "console" })).toBe("console");
    expect(attendedSpawnModeFromEnv({ ATTENDED_SPAWN_MODE: "bogus" })).toBe("pty");
  });
});
