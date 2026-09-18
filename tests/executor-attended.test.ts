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
  IDLE_REAP_MS,
  NOTICE_RETRY_MS,
  STALL_NUDGE_MS,
  notifyAttendedSession,
  isAttendedSessionReachable,
} from "@/executor/attended";
import type { WindowsSpawnOptions } from "@/executor/attended-win";
import { clearNotices } from "@/executor/attended-session";
import { startExecutor, finishRun, claimNextRun } from "@/executor/runner";
import { seedOwner } from "./helpers";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

const child = (over: Partial<NonNullable<Parameters<typeof decide>[0]["spawn"]>> = {}) => ({
  pid: 1,
  runId: 7,
  alive: true,
  reachable: true,
  idleForMs: null,
  queuedNoticeDue: true,
  ...over,
});
const input = (over: Partial<Parameters<typeof decide>[0]> = {}) => ({ queuedRunId: null, heartbeatAgeMs: null, approvalsWaiting: false, spawn: null, ...over });

describe("attended dispatcher — decide()", () => {
  it("does nothing when nothing is queued", () => {
    expect(decide(input()).action).toBe("none");
  });
  it("spawns for a queued run when there was never a heartbeat or it is stale", () => {
    expect(decide(input({ queuedRunId: 7 }))).toMatchObject({ action: "spawn", runId: 7 });
    expect(decide(input({ queuedRunId: 7, heartbeatAgeMs: HEARTBEAT_STALE_MS + 1 })).action).toBe("spawn");
  });
  it("defers to a live attended session (fresh heartbeat)", () => {
    expect(decide(input({ queuedRunId: 7, heartbeatAgeMs: 5_000 })).action).toBe("none");
  });
  it("tells a live, reachable child about a queued run instead of spawning a second one", () => {
    expect(decide(input({ queuedRunId: 9, spawn: child() }))).toMatchObject({ action: "notify", pid: 1, runId: 9 });
    // ... but only once per NOTICE_RETRY_MS window.
    expect(decide(input({ queuedRunId: 9, spawn: child({ queuedNoticeDue: false }) })).action).toBe("none");
    // ... and not while the child is still on a run of its own: a follow-up queued behind the
    // current run (src/apply/followup.ts) waits for the child's own claim-next after it finishes.
    expect(decide(input({ queuedRunId: 9, runningRunId: 8, spawn: child() })).action).toBe("none");
    expect(decide(input({ queuedRunId: 9, runningRunId: null, spawn: child() })).action).toBe("notify");
  });
  it("nudges a reachable child whose own run has gone quiet, throttled, never while it is working or has no run", () => {
    const quiet = STALL_NUDGE_MS;
    expect(decide(input({ runningRunId: 8, runningQuietMs: quiet, stallNoticeDue: true, spawn: child() }))).toMatchObject({ action: "nudge", pid: 1, runId: 8 });
    expect(decide(input({ runningRunId: 8, runningQuietMs: quiet - 1, stallNoticeDue: true, spawn: child() })).action).toBe("none");
    expect(decide(input({ runningRunId: 8, runningQuietMs: quiet, stallNoticeDue: false, spawn: child() })).action).toBe("none");
    expect(decide(input({ runningRunId: null, runningQuietMs: quiet, stallNoticeDue: true, spawn: child() })).action).toBe("none");
    // An unreachable child cannot be nudged; a queued run it can hear about is announced first.
    expect(decide(input({ runningRunId: 8, runningQuietMs: quiet, stallNoticeDue: true, spawn: child({ reachable: false }) })).action).toBe("none");
    expect(decide(input({ queuedRunId: 9, runningRunId: null, runningQuietMs: quiet, stallNoticeDue: true, spawn: child() })).action).toBe("notify");
  });
  it("keeps a child alive without any age limit while it has work, and reaps it only after idling", () => {
    expect(decide(input({ spawn: child({ idleForMs: null }) })).action).toBe("none");
    expect(decide(input({ spawn: child({ idleForMs: IDLE_REAP_MS - 1 }) })).action).toBe("none");
    expect(decide(input({ spawn: child({ idleForMs: IDLE_REAP_MS }) }))).toMatchObject({ action: "reap", pid: 1 });
  });
  it("reaps a dead child", () => {
    expect(decide(input({ spawn: child({ alive: false }) }))).toMatchObject({ action: "reap", pid: 1 });
  });
  it("reaps an unreachable child (server restarted) only when there is work it cannot be told about", () => {
    expect(decide(input({ spawn: child({ reachable: false }) })).action).toBe("none");
    expect(decide(input({ queuedRunId: 9, spawn: child({ reachable: false }) })).action).toBe("reap");
    expect(decide(input({ approvalsWaiting: true, spawn: child({ reachable: false }) })).action).toBe("reap");
    expect(decide(input({ spawn: child({ reachable: false, idleForMs: IDLE_REAP_MS }) })).action).toBe("reap");
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

  it("spawns an expect-wrapped claude --chrome for a queued run, keeps it while it has work, tells it about later runs, and reaps it once idle", () => {
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    const run = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 1 }] }, { logDir }, "user_chrome");
    const spawned: { scriptPath: string; logPath: string }[] = [];
    const killed: number[] = [];
    const typed: { pid: number; line: string }[] = [];
    let clock = new Date();
    const deps = {
      now: () => clock,
      isAlive: () => true,
      reachable: () => true,
      write: (pid: number, line: string) => {
        typed.push({ pid, line });
        return true;
      },
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
    expect(attendedStatus(db, U, deps).spawn).toMatchObject({ pid: 4242, alive: true, reachable: true });
    expect(isAttendedSessionReachable(db, deps)).toBe(true);

    // Second tick right after the spawn: the run it was started for is still queued, but it was
    // handed over in the prompt, so no reminder yet.
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    expect(typed).toHaveLength(0);

    // The child claims and finishes the run, then a second run is queued: the live child is told
    // about it (no second spawn), once, and again after NOTICE_RETRY_MS if it has not claimed it.
    expect(claimNextRun(db, U, "user_chrome")?.id).toBe(run.id);
    finishRun(db, U, run.id, "done", "ok");
    const run2 = startExecutor(db, U, "apply", { resume: true }, { logDir }, "user_chrome");
    const r2 = dispatchAttended(db, deps);
    expect(r2.decision).toMatchObject({ action: "notify", pid: 4242, runId: run2.id });
    expect(r2.notified).toBe(true);
    expect(typed).toEqual([{ pid: 4242, line: expect.stringContaining(`run ${run2.id} queued (apply)`) }]);
    clock = new Date(clock.getTime() + 10_000);
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    clock = new Date(clock.getTime() + NOTICE_RETRY_MS);
    expect(dispatchAttended(db, deps).decision.action).toBe("notify");
    expect(typed).toHaveLength(2);
    expect(spawned).toHaveLength(1);

    // It claims and finishes that too. With nothing running, queued, or awaiting the user the
    // session is idle; it is kept for IDLE_REAP_MS and then reaped — never for being old.
    expect(claimNextRun(db, U, "user_chrome")?.id).toBe(run2.id);
    finishRun(db, U, run2.id, "done", "ok");
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    expect(currentSpawn(db)?.idleSince).toBe(clock.toISOString());
    clock = new Date(clock.getTime() + IDLE_REAP_MS - 1000);
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    clock = new Date(clock.getTime() + 2000);
    const r3 = dispatchAttended(db, deps);
    expect(r3.decision.action).toBe("reap");
    expect(killed).toEqual([4242]);
    expect(currentSpawn(db)).toBeNull();
  });

  it("a filled application waiting on the user keeps the session alive indefinitely; approvals are typed into it", () => {
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    const run = startExecutor(db, U, "apply", {}, { logDir }, "user_chrome");
    const jobId = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, created_at) VALUES (?,?,?,?,?,?,?)")
      .run("fp-1", "Acme", "SWE", "https://acme.example/apply", "greenhouse", "manual", "2026-01-01 00:00:00").lastInsertRowid as number;
    // A form waiting on the user's answers is an open tab too: it keeps the session just the same.
    db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'needs_info')").run(jobId);
    const typed: string[] = [];
    let clock = new Date();
    const deps = {
      now: () => clock,
      isAlive: () => true,
      reachable: () => true,
      write: (_pid: number, line: string) => {
        typed.push(line);
        return true;
      },
      spawnExpect: () => ({ pid: 7 }),
      kill: () => {
        throw new Error("must not reap while a form waits on the user");
      },
      claudeBin: "/fake/claude",
      logDir,
      cwd: "/fake",
      platform: "darwin" as const,
    };
    expect(dispatchAttended(db, deps).decision.action).toBe("spawn");
    claimNextRun(db, U, "user_chrome");
    finishRun(db, U, run.id, "done", "filled one");

    // Days pass; the tab for the filled form is still open in that session.
    clock = new Date(clock.getTime() + 3 * 24 * 3600_000);
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    expect(currentSpawn(db)?.idleSince ?? null).toBeNull();

    db.prepare("UPDATE applications SET status = 'awaiting_confirm' WHERE job_id = ?").run(jobId);
    clock = new Date(clock.getTime() + 3 * 24 * 3600_000);
    expect(dispatchAttended(db, deps).decision.action).toBe("none");

    // The App types the approval straight into the session.
    expect(notifyAttendedSession(db, "[Sortie] approved job 1", deps)).toBe(true);
    expect(typed).toEqual(["[Sortie] approved job 1"]);
  });

  it("reaps an unreachable child (this process restarted) as soon as there is work to tell it about", () => {
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    const run = startExecutor(db, U, "apply", {}, { logDir }, "user_chrome");
    const killed: number[] = [];
    const deps = { isAlive: () => true, reachable: () => false, spawnExpect: () => ({ pid: 5 }), kill: (pid: number) => { killed.push(pid); }, claudeBin: "/fake/claude", logDir, cwd: "/fake", platform: "darwin" as const };
    expect(dispatchAttended(db, deps).decision.action).toBe("spawn");
    claimNextRun(db, U, "user_chrome");
    // Nothing queued, nothing approved: the unreachable child is left alone (it may be filling).
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    finishRun(db, U, run.id, "done", "ok");
    startExecutor(db, U, "apply", { resume: true }, { logDir }, "user_chrome");
    // A queued run it cannot hear about: reap, and the next tick spawns a fresh session for it.
    expect(dispatchAttended(db, deps).decision.action).toBe("reap");
    expect(killed).toEqual([5]);
    expect(notifyAttendedSession(db, "x", deps)).toBe(false);
    expect(dispatchAttended(db, deps).decision.action).toBe("spawn");
  });

  it("closes out the running run of a child that died, so nothing waits 20 minutes for a stale log", () => {
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    const run = startExecutor(db, U, "apply", {}, { logDir }, "user_chrome");
    let alive = true;
    const deps = { isAlive: () => alive, reachable: () => true, spawnExpect: () => ({ pid: 1 }), kill: () => {}, claudeBin: "/fake/claude", logDir, cwd: "/fake", platform: "darwin" as const };
    expect(dispatchAttended(db, deps).decision.action).toBe("spawn");
    claimNextRun(db, U, "user_chrome");
    alive = false;
    expect(dispatchAttended(db, deps).decision.action).toBe("reap");
    const row = db.prepare("SELECT status, summary FROM executor_runs WHERE id=?").get(run.id) as { status: string; summary: string };
    expect(row.status).toBe("failed");
    expect(row.summary).toMatch(/attended session ended/);
  });

  it("types a stall reminder into a child whose run has been silent, once per STALL_NUDGE_MS, and stops once the run ends", () => {
    clearNotices();
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    const run = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 10, mode: "direct" }], chunk: 10 }, { logDir }, "user_chrome");
    const typed: string[] = [];
    const t0 = Date.parse("2026-09-18T01:29:47Z"); // NOV's last log line, run #118
    let now = t0;
    let lastLog = t0;
    const deps = {
      now: () => new Date(now),
      isAlive: () => true,
      reachable: () => true,
      write: (_pid: number, line: string) => { typed.push(line); return true; },
      mtime: () => lastLog,
      spawnExpect: () => ({ pid: 1 }),
      kill: () => {},
      claudeBin: "/fake/claude",
      logDir,
      cwd: "/fake",
      platform: "darwin" as const,
    };
    expect(dispatchAttended(db, deps).decision.action).toBe("spawn");
    claimNextRun(db, U, "user_chrome");
    // Working normally: the log is fresh, nothing is typed.
    now = t0 + 5 * 60_000;
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    expect(typed).toEqual([]);
    // Fifty minutes of silence with the run still running: one reminder naming the run.
    now = t0 + 50 * 60_000;
    expect(dispatchAttended(db, deps).decision).toMatchObject({ action: "nudge", pid: 1, runId: run.id });
    expect(typed).toHaveLength(1);
    expect(typed[0]).toMatch(new RegExp(`^\\[Sortie\\] run ${run.id} is still running .*50 min`));
    expect(typed[0]).toContain("carry on");
    // Not repeated every tick; again after another STALL_NUDGE_MS of silence.
    now += 10_000;
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    now += STALL_NUDGE_MS;
    expect(dispatchAttended(db, deps).decision.action).toBe("nudge");
    expect(typed).toHaveLength(2);
    // The session picks up again: a fresh log line resets the clock.
    lastLog = now;
    now += STALL_NUDGE_MS - 1_000;
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    // Run over: nothing running, so nothing to remind it of.
    lastLog = t0;
    finishRun(db, U, run.id, "done", "ok");
    now += 2 * STALL_NUDGE_MS;
    expect(dispatchAttended(db, deps).decision.action).toBe("none");
    expect(typed).toHaveLength(2);
  });

  it("a reaped child's mid-segment plan chains on to a fresh session instead of dying with it", () => {
    clearNotices();
    const db = openDb(":memory:");
    seedOwner(db, U);
    const logDir = tmp();
    const run = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 30, mode: "direct" }], chunk: 10 }, { logDir }, "user_chrome");
    let alive = true;
    const deps = { isAlive: () => alive, reachable: () => true, spawnExpect: () => ({ pid: 1 }), kill: () => {}, claudeBin: "/fake/claude", logDir, cwd: "/fake", platform: "darwin" as const };
    expect(dispatchAttended(db, deps).decision.action).toBe("spawn");
    claimNextRun(db, U, "user_chrome");
    alive = false;
    expect(dispatchAttended(db, deps).decision.action).toBe("reap");
    expect((db.prepare("SELECT status FROM executor_runs WHERE id=?").get(run.id) as { status: string }).status).toBe("failed");
    const next = db.prepare("SELECT id, status, options FROM executor_runs WHERE id > ? ORDER BY id").all(run.id) as { id: number; status: string; options: string }[];
    expect(next).toHaveLength(1);
    expect(next[0].status).toBe("queued");
    expect(JSON.parse(next[0].options)).toMatchObject({ resume: true, plan: [{ direction: "swe_general", count: 30, mode: "direct" }], chain: { root: run.id, step: 2 } });
    // Next tick: a fresh session for the continuation.
    alive = true;
    expect(dispatchAttended(db, deps).decision).toMatchObject({ action: "spawn", runId: next[0].id });
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
    expect(p).toContain("--data-binary @/tmp/sortie-body.json");
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
