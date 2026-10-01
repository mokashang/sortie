import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import {
  planDispatch,
  dispatchAttended,
  currentSpawns,
  notifyJobSession,
  notifyRunSession,
  isJobSessionReachable,
  attendedBusyDetail,
  attendedStatus,
  heldByOtherSession,
  STALL_NUDGE_MS,
  type PlanInput,
  type SessionInput,
} from "@/executor/attended";
import { clearNotices } from "@/executor/attended-session";
import { startExecutor, claimNextRun, finishRun, reapStaleRuns, attendedChildAlive } from "@/executor/runner";
import {
  callerApplyRunId,
  sessionOfCaller,
  sessionOfJob,
  attendedParallel,
  setAttendedParallel,
  listSpawns,
  saveSpawns,
  LEGACY_SPAWN_KEY,
  SPAWNS_KEY,
  type SpawnRecord,
} from "@/executor/sessions";
import { DEFAULT_PARALLEL } from "@/app/lib/parallel";
import { leaseSendables, OUTREACH_LEASE_MS } from "@/network/send-lease";
import { maybeContinueApplyRun, resumePausedChainIfReady } from "@/apply/continue";
import { requeueStrandedApprovals, decideAndMaybeAutoStart } from "@/apply/decide-auto-start";

// Parallel apply tasks (2026-09-30, spec docs/superpowers/specs/2026-09-30-parallel-apply-design.md):
// the user starts a second apply task while one is on and both go, each in its own attended session.

const U = "legacy";

const session = (over: Partial<SessionInput> = {}): SessionInput => ({
  pid: 1,
  runId: 1,
  alive: true,
  reachable: true,
  idleForMs: null,
  runningRunId: null,
  runningQuietMs: null,
  stallNoticeDue: false,
  booting: false,
  approvalsWaiting: false,
  ...over,
});
const q = (id: number, toldTo: number[] = []) => ({ id, toldTo });
const plan = (over: Partial<PlanInput>) => planDispatch({ queued: [], heartbeatAgeMs: null, maxSessions: 2, sessions: [], ...over });

describe("planDispatch — several sessions", () => {
  it("spawns one session per queued run, up to the limit", () => {
    expect(plan({ queued: [q(1), q(2), q(3)] }).actions).toMatchObject([
      { action: "spawn", runId: 1 },
      { action: "spawn", runId: 2 },
    ]);
    expect(plan({ queued: [q(1), q(2)], maxSessions: 1 }).actions).toMatchObject([{ action: "spawn", runId: 1 }]);
  });

  it("a second task gets a second session while the first works its run; with a limit of 1 it waits", () => {
    const busy = session({ pid: 10, runningRunId: 1 });
    expect(plan({ queued: [q(2)], sessions: [busy] }).actions).toMatchObject([{ action: "spawn", runId: 2 }]);
    expect(plan({ queued: [q(2)], sessions: [busy], maxSessions: 1 }).actions).toEqual([]);
  });

  it("tells each free session about a different queued run, and never the busy one", () => {
    const busy = session({ pid: 12, runningRunId: 5 });
    const a = session({ pid: 10 });
    const b = session({ pid: 11 });
    expect(plan({ queued: [q(6), q(7)], sessions: [busy, a, b], maxSessions: 3 }).actions).toMatchObject([
      { action: "notify", pid: 10, runId: 6 },
      { action: "notify", pid: 11, runId: 7 },
    ]);
  });

  it("a run told to a live session recently is taken care of; told to a session that is gone, it is not", () => {
    const a = session({ pid: 10 });
    expect(plan({ queued: [q(6, [10]), q(7)], sessions: [a] }).actions).toMatchObject([{ action: "spawn", runId: 7 }]);
    expect(plan({ queued: [q(6, [99])] }).actions).toMatchObject([{ action: "spawn", runId: 6 }]);
  });

  it("a session still starting up covers one queued run; the next one gets a session of its own", () => {
    expect(plan({ queued: [q(1), q(2)], sessions: [session({ pid: 10, booting: true })] }).actions).toMatchObject([{ action: "spawn", runId: 2 }]);
  });

  it("an unreachable session still on its own run is left to finish it; between runs it is reaped, and nothing spawns that tick", () => {
    expect(plan({ queued: [q(2)], sessions: [session({ pid: 10, reachable: false, runningRunId: 1 })] }).actions).toMatchObject([
      { action: "spawn", runId: 2 },
    ]);
    expect(plan({ queued: [q(2)], sessions: [session({ pid: 10, reachable: false })] }).actions).toMatchObject([{ action: "reap", pid: 10 }]);
  });

  it("nudges only the session whose own run went quiet", () => {
    const quiet = session({ pid: 10, runningRunId: 1, runningQuietMs: STALL_NUDGE_MS, stallNoticeDue: true });
    const working = session({ pid: 11, runningRunId: 2, runningQuietMs: 1000, stallNoticeDue: true });
    expect(plan({ sessions: [quiet, working] }).actions).toMatchObject([{ action: "nudge", pid: 10, runId: 1 }]);
  });

  it("a desktop session's fresh heartbeat still stops spawning", () => {
    expect(plan({ queued: [q(1)], heartbeatAgeMs: 1000 }).actions).toEqual([]);
  });
});

describe("parallel sessions against a db", () => {
  let db: DB;
  let logDir: string;
  let clock: Date;
  let nextPid: number;
  let alive: (pid: number) => boolean;
  const typed: { pid: number; line: string }[] = [];
  let seq = 0;

  beforeEach(() => {
    clearNotices();
    db = openDb(":memory:");
    seedOwner(db, U);
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "attended-parallel-"));
    // In the past: claim-next stamps claimed_at with SQLite's real clock, and a run belongs to a
    // session only when it was claimed after the session started.
    clock = new Date("2026-01-05T10:00:00Z");
    nextPid = 100;
    alive = () => true;
    typed.length = 0;
  });
  afterEach(() => {
    db.close();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  const deps = () => ({
    now: () => clock,
    isAlive: (pid: number) => alive(pid),
    reachable: () => true,
    write: (pid: number, line: string) => {
      typed.push({ pid, line });
      return true;
    },
    spawnExpect: () => ({ pid: ++nextPid }),
    kill: () => {},
    claudeBin: "/fake/claude",
    logDir,
    cwd: "/fake",
    platform: "darwin" as const,
  });
  const startApply = (direction: string) =>
    startExecutor(db, U, "apply", { plan: [{ direction, count: 3, mode: "direct" }], chunk: 10 }, { logDir, queueBehind: true }, "user_chrome");
  const filledJob = (runId: number, status = "awaiting_confirm", decision: string | null = null) => {
    seq += 1;
    const jobId = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(`fp-par-${seq}`, `Co${seq}`, "SWE", `https://co${seq}.example/apply`, "greenhouse", "manual", "2026-01-01 00:00:00").lastInsertRowid as number;
    db.prepare("INSERT INTO applications (job_id, status, run_id, confirm_decision) VALUES (?, ?, ?, ?)").run(jobId, status, runId, decision);
    return jobId;
  };
  const statusOf = (id: number) => (db.prepare("SELECT status FROM executor_runs WHERE id = ?").get(id) as { status: string }).status;

  it("two tasks started back to back each get a session, claim one run each, and every line reaches the right terminal", () => {
    const d = deps();
    const r1 = startApply("swe_general");
    const r2 = startApply("swe_backend");
    expect(dispatchAttended(db, d).actions).toMatchObject([
      { action: "spawn", runId: r1.id },
      { action: "spawn", runId: r2.id },
    ]);
    const [s1, s2] = currentSpawns(db);
    expect([s1.pid, s2.pid]).toEqual([101, 102]);
    expect(sessionOfCaller(db, { via: "run", runId: s2.runId })?.pid).toBe(102);
    expect(sessionOfCaller(db, { via: "internal", runId: null })).toBeNull();

    // The second one is up first and takes the oldest queued run; it works one run at a time.
    expect(claimNextRun(db, U, "user_chrome", undefined, s2)?.id).toBe(r1.id);
    expect(claimNextRun(db, U, "user_chrome", undefined, s2)).toBeNull();
    expect(claimNextRun(db, U, "user_chrome", undefined, s1)?.id).toBe(r2.id);

    // Jobs each one takes are booked to its own run, not to "the newest running one".
    expect(callerApplyRunId(db, U, { via: "run", runId: s1.runId })).toBe(r2.id);
    expect(callerApplyRunId(db, U, { via: "run", runId: s2.runId })).toBe(r1.id);
    expect(callerApplyRunId(db, U, { via: "internal", runId: null })).toBeUndefined();

    // Approvals, answers and stops go to the session that holds the tab / the run.
    const jobA = filledJob(r1.id);
    const jobB = filledJob(r2.id);
    expect(sessionOfJob(db, U, jobA)?.pid).toBe(s2.pid);
    expect(isJobSessionReachable(db, U, jobB, d)).toBe(true);
    expect(notifyJobSession(db, U, jobA, "[Sortie] approved A", d)).toBe(true);
    expect(notifyJobSession(db, U, jobB, "[Sortie] approved B", d)).toBe(true);
    expect(notifyRunSession(db, r2.id, "[Sortie] run stopped", d)).toBe(true);
    expect(typed).toEqual([
      { pid: s2.pid, line: "[Sortie] approved A" },
      { pid: s1.pid, line: "[Sortie] approved B" },
      { pid: s1.pid, line: "[Sortie] run stopped" },
    ]);

    // Each is held by its own run and its own form, not the other's.
    expect(attendedBusyDetail(db, U, s1)).toMatchObject({ runs: [{ id: r2.id }], waiting: { awaiting_confirm: 1 }, stale: 0 });
    expect(attendedBusyDetail(db, U, s2)).toMatchObject({ runs: [{ id: r1.id }], waiting: { awaiting_confirm: 1 }, stale: 0 });
    // A resume phase in one session leaves the other's form alone.
    expect(heldByOtherSession(db, U, jobA, s1, d)).toBe(true);
    expect(heldByOtherSession(db, U, jobA, s2, d)).toBe(false);

    // Both working: nothing to do. The status endpoint lists both.
    expect(dispatchAttended(db, d).actions).toEqual([]);
    expect(attendedStatus(db, U, d).spawns.map((s) => s.pid)).toEqual([101, 102]);

    // One finishes: its session is free and is told about the next queued task.
    finishRun(db, U, r2.id, "done", "ok");
    db.prepare("UPDATE applications SET status = 'submitted' WHERE job_id = ?").run(jobB);
    const r3 = startApply("swe_general");
    typed.length = 0;
    expect(dispatchAttended(db, d).actions).toMatchObject([{ action: "notify", pid: s1.pid, runId: r3.id }]);
    expect(typed[0]).toMatchObject({ pid: s1.pid, line: expect.stringContaining(`run ${r3.id} queued`) });
  });

  it("with the limit at 1 the second task waits for the first session, as before", () => {
    setAttendedParallel(db, 1);
    expect(attendedParallel(db)).toBe(1);
    const d = deps();
    const r1 = startApply("swe_general");
    const r2 = startApply("swe_backend");
    expect(dispatchAttended(db, d).actions).toMatchObject([{ action: "spawn", runId: r1.id }]);
    const [s1] = currentSpawns(db);
    expect(claimNextRun(db, U, "user_chrome", undefined, s1)?.id).toBe(r1.id);
    expect(dispatchAttended(db, d).actions).toEqual([]);
    finishRun(db, U, r1.id, "done", "ok");
    expect(dispatchAttended(db, d).actions).toMatchObject([{ action: "notify", pid: s1.pid, runId: r2.id }]);
    expect(currentSpawns(db)).toHaveLength(1);
  });

  it("a session that dies takes only its own run with it", () => {
    const d = deps();
    const r1 = startApply("swe_general");
    const r2 = startApply("swe_backend");
    dispatchAttended(db, d);
    const [s1, s2] = currentSpawns(db);
    claimNextRun(db, U, "user_chrome", undefined, s1);
    claimNextRun(db, U, "user_chrome", undefined, s2);
    alive = (pid) => pid !== s1.pid;
    expect(dispatchAttended(db, d).actions).toMatchObject([{ action: "reap", pid: s1.pid }]);
    expect(statusOf(r1.id)).toBe("failed");
    expect(statusOf(r2.id)).toBe("running");
    expect(currentSpawns(db).map((s) => s.pid)).toEqual([s2.pid]);
    // Its plan chains on to a fresh session (cf. executor-attended), which is spawned next tick.
    const next = db.prepare("SELECT id FROM executor_runs WHERE status = 'queued'").all() as { id: number }[];
    expect(next).toHaveLength(1);
    expect(dispatchAttended(db, d).actions).toMatchObject([{ action: "spawn", runId: next[0].id }]);
  });

  it("the stale-run reaper asks each run's own session whether it is alive", () => {
    const r1 = startApply("swe_general");
    const r2 = startApply("swe_backend");
    const live: SpawnRecord = { pid: process.pid, runId: r1.id, startedAt: clock.toISOString(), logPath: "", idleSince: null };
    const dead: SpawnRecord = { pid: 2_000_000_000, runId: r2.id, startedAt: clock.toISOString(), logPath: "", idleSince: null };
    saveSpawns(db, [live, dead]);
    claimNextRun(db, U, "user_chrome", undefined, live);
    claimNextRun(db, U, "user_chrome", undefined, dead);
    const runOf = (id: number) => db.prepare("SELECT pid, claimed_at, channel FROM executor_runs WHERE id = ?").get(id) as never;
    expect(attendedChildAlive(db, runOf(r1.id))).toBe(true);
    expect(attendedChildAlive(db, runOf(r2.id))).toBe(false);
    // Both logs silent for an hour: only the run whose session is gone is retired.
    reapStaleRuns(db, { now: () => Date.now() + 60 * 60_000 });
    expect(statusOf(r1.id)).toBe("running");
    expect(statusOf(r2.id)).toBe("failed");
  });

  it("a session between runs re-opening a form keeps it booked to the run it last worked; a headless run books to itself", () => {
    const d = deps();
    const r1 = startApply("swe_general");
    dispatchAttended(db, d);
    const [s1] = currentSpawns(db);
    claimNextRun(db, U, "user_chrome", undefined, s1);
    finishRun(db, U, r1.id, "done", "ok");
    expect(callerApplyRunId(db, U, { via: "run", runId: s1.runId })).toBe(r1.id);
    const headless = db
      .prepare("INSERT INTO executor_runs (user_id, kind, status, channel, pid, options) VALUES (?, 'apply', 'running', 'headless', 1, '{}')")
      .run(U).lastInsertRowid as number;
    expect(callerApplyRunId(db, U, { via: "run", runId: headless })).toBe(headless);
  });

  it("a task's next segment is queued even while another task is on, and every parked chain resumes once confirmations come down", () => {
    const d = deps();
    const r1 = startApply("swe_general");
    const r2 = startApply("swe_backend");
    dispatchAttended(db, d);
    const [s1, s2] = currentSpawns(db);
    claimNextRun(db, U, "user_chrome", undefined, s1);
    claimNextRun(db, U, "user_chrome", undefined, s2);
    finishRun(db, U, r1.id, "done", "segment 1");
    // r2 is still running: before 2026-09-30 this parked as 「等排在前面的任务做完再继续」.
    expect(maybeContinueApplyRun(db, r1.id, { logDir })).toMatchObject({ action: "queued" });

    const park = () =>
      db
        .prepare("INSERT INTO executor_runs (user_id, kind, status, channel, options, summary) VALUES (?, 'apply', 'paused', 'user_chrome', '{}', 'x')")
        .run(U).lastInsertRowid as number;
    const p1 = park();
    const p2 = park();
    expect(resumePausedChainIfReady(db, U, { logDir })).toMatchObject({ action: "queued", runId: p2 });
    expect([statusOf(p1), statusOf(p2)]).toEqual(["queued", "queued"]);
  });

  it("only approvals no reachable session holds count as stranded; the approve path tells the job's own session", () => {
    const jobHeld = filledJob(1, "awaiting_confirm", "approved");
    const jobLost = filledJob(2, "awaiting_confirm", "approved");
    const startExecutorStub = (() => ({ id: 77, pid: null, logPath: "/tmp/x" })) as unknown as typeof startExecutor;
    const base = { hasLiveOrQueuedRun: () => false, lastRunChannel: () => "user_chrome" as const, startExecutor: startExecutorStub };
    expect(requeueStrandedApprovals(db, U, { ...base, attendedReachable: () => true })).toEqual({ autoStarted: false });
    expect(requeueStrandedApprovals(db, U, { ...base, attendedReachable: (id) => id === jobHeld })).toMatchObject({ autoStarted: true, runId: 77 });
    expect(jobLost).toBeGreaterThan(jobHeld);

    const fresh = filledJob(3);
    const told: number[] = [];
    const r = decideAndMaybeAutoStart(db, U, fresh, "approve", undefined, {
      ...base,
      notifyAttended: (_line, jobId) => {
        told.push(jobId);
        return true;
      },
    });
    expect(r).toEqual({ autoStarted: false, notified: true });
    expect(told).toEqual([fresh]);
  });

  it("approved messages are leased to one session at a time", () => {
    const s1: SpawnRecord = { pid: 501, runId: 1, startedAt: clock.toISOString(), logPath: "", idleSince: null };
    const s2: SpawnRecord = { pid: 502, runId: 2, startedAt: clock.toISOString(), logPath: "", idleSince: null };
    saveSpawns(db, [s1, s2]);
    const rows = [{ id: 1 }, { id: 2 }];
    const t = 1_000_000;
    expect(leaseSendables(db, rows, s1, () => true, t)).toEqual(rows);
    expect(leaseSendables(db, rows, s2, () => true, t + 1000)).toEqual([]);
    // The holder asking again keeps them.
    expect(leaseSendables(db, rows, s1, () => true, t + 2000)).toEqual(rows);
    // A holder that cannot be reached any more, or a lease that ran out, lets the other one take them.
    expect(leaseSendables(db, rows, s2, () => false, t + 3000)).toEqual(rows);
    expect(leaseSendables(db, [{ id: 3 }], s1, () => true, t + 4000)).toEqual([{ id: 3 }]);
    expect(leaseSendables(db, [{ id: 3 }], s2, () => true, t + 4000 + OUTREACH_LEASE_MS)).toEqual([{ id: 3 }]);
  });

  it("reads the single record a pre-2026-09-30 server left behind, and moves it on the next write", () => {
    const old = { pid: 7, runId: 3, startedAt: clock.toISOString(), logPath: "/x" };
    db.prepare("INSERT INTO profile (key, value) VALUES (?, ?)").run(LEGACY_SPAWN_KEY, JSON.stringify(old));
    expect(listSpawns(db)).toEqual([old]);
    saveSpawns(db, listSpawns(db));
    const keys = (db.prepare("SELECT key FROM profile WHERE key IN (?, ?)").all(LEGACY_SPAWN_KEY, SPAWNS_KEY) as { key: string }[]).map((r) => r.key);
    expect(keys).toEqual([SPAWNS_KEY]);
    expect(attendedParallel(openDb(":memory:"))).toBe(DEFAULT_PARALLEL);
    expect(() => setAttendedParallel(db, 9)).toThrow();
  });
});
