import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb } from "@/lib/db";
import {
  decide,
  planDispatch,
  dispatchAttended,
  currentSpawn,
  currentSpawns,
  buildAttendedPrompt,
  LOGIN_ALERT_EVERY_MS,
  LOGIN_HOLD_KEY,
  EARLY_EXIT_LIMIT,
  STALL_NUDGE_MS,
  STALL_REAP_AFTER_NUDGES,
} from "@/executor/attended";
import { clearNotices, markSignedOutBanner, queuedRunNotice, resetAttendedRegistry, signedOutBannerAt } from "@/executor/attended-session";
import { SignedOutWatcher, spawnAttendedPty, type PtyModule, type PtyProcess } from "@/executor/attended-win";
import {
  LOGIN_CHECK_MS,
  LOGIN_RECHECK_MS,
  currentCliLogin,
  parseLoginStatus,
  refreshCliLogin,
  requestCliLoginCheck,
  resetCliLogin,
  showsSignedOut,
  signedOutSummary,
  type CliLogin,
} from "@/executor/cli-login";
import { claimNextRun, startExecutor } from "@/executor/runner";
import { setAiProvider } from "@/ai/config";
import { messages } from "@/i18n/messages";
import { seedOwner } from "./helpers";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cli-login-"));
const T0 = Date.parse("2026-11-03T05:15:00Z"); // 22:15 local on 11-02, when the login went

beforeEach(() => {
  resetCliLogin();
  resetAttendedRegistry();
  clearNotices();
});

// The dispatcher with its outside world faked: `login` is what the last sign-in check said.
function harness(login: CliLogin, over: { maxSessions?: number } = {}) {
  const db = openDb(":memory:");
  seedOwner(db, U);
  const logDir = tmp();
  const h = {
    db,
    logDir,
    clock: T0,
    login,
    alerts: [] as string[],
    typed: [] as string[],
    killed: [] as number[],
    alive: new Set<number>(),
    nextPid: 100,
    mtime: null as number | null,
  };
  const deps = {
    now: () => new Date(h.clock),
    isAlive: (pid: number) => h.alive.has(pid),
    reachable: () => true,
    write: (_pid: number, line: string) => {
      h.typed.push(line);
      return true;
    },
    spawnExpect: () => {
      const pid = ++h.nextPid;
      h.alive.add(pid);
      return { pid };
    },
    kill: (pid: number) => {
      h.killed.push(pid);
      h.alive.delete(pid);
    },
    claudeBin: "/fake/claude",
    logDir,
    cwd: "/fake",
    platform: "darwin" as const,
    aiProvider: "claude" as const,
    cliLogin: () => h.login,
    alert: (title: string) => {
      h.alerts.push(title);
    },
    mtime: () => h.mtime,
    ...over,
  };
  const tick = () => dispatchAttended(db, deps);
  // n dispatcher ticks, 10 s apart.
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      h.clock += 10_000;
      tick();
    }
  };
  const statusOf = (id: number) => (db.prepare("SELECT status FROM executor_runs WHERE id=?").get(id) as { status: string }).status;
  const queue = () => startExecutor(db, U, "apply", {}, { logDir, queueBehind: true }, "user_chrome");
  return { h, deps, tick, run, statusOf, queue, db };
}
const signedOut = (at: number): CliLogin => ({ signedIn: false, at });
const signedIn = (at: number): CliLogin => ({ signedIn: true, at });

describe("planner while the CLI is signed out", () => {
  const child = { pid: 1, runId: 7, alive: true, reachable: true, idleForMs: null, queuedNoticeDue: true };
  const base = { heartbeatAgeMs: null, approvalsWaiting: false };

  it("spawns nothing and tells nobody", () => {
    expect(decide({ ...base, queuedRunId: 7, spawn: null, signedOut: true })).toMatchObject({ action: "none", reason: expect.stringContaining("signed out") });
    expect(decide({ ...base, queuedRunId: 9, spawn: child, signedOut: true }).action).toBe("none");
  });
  it("neither reminds nor reaps a session gone quiet: it is waiting on the login, not wedged", () => {
    const quiet = { runningRunId: 8, runningQuietMs: 5 * STALL_NUDGE_MS, stallNoticeDue: true };
    expect(decide({ ...base, ...quiet, queuedRunId: null, spawn: child })).toMatchObject({ action: "nudge" });
    expect(decide({ ...base, ...quiet, queuedRunId: null, spawn: child, signedOut: true }).action).toBe("none");
  });
  it("does not reap a session for reminders it went unanswered before the sign-out was known", () => {
    const session = { pid: 1, runId: 7, alive: true, reachable: true, idleForMs: null, runningRunId: 8, runningQuietMs: 5 * STALL_NUDGE_MS, stallNoticeDue: true, stallNudgesSent: STALL_REAP_AFTER_NUDGES, booting: false, approvalsWaiting: false };
    const plan = { queued: [], heartbeatAgeMs: null, maxSessions: 2, sessions: [session] };
    expect(planDispatch(plan).actions).toMatchObject([{ action: "reap", pid: 1 }]);
    expect(planDispatch({ ...plan, signedOut: true }).actions).toEqual([]);
  });
  it("still clears a session that exited", () => {
    expect(decide({ ...base, queuedRunId: 7, spawn: { ...child, alive: false }, signedOut: true }).action).toBe("reap");
  });
  it("gives a session that came up signed out no work, and replaces it once told to", () => {
    expect(decide({ ...base, queuedRunId: 9, spawn: { ...child, signedOutStart: "wait" } }).action).toBe("none");
    expect(decide({ ...base, queuedRunId: 9, spawn: { ...child, signedOutStart: "replace" } })).toMatchObject({ action: "reap", pid: 1 });
  });
});

describe("dispatcher while the CLI is signed out", () => {
  it("leaves the run queued, spawns nothing, types nothing, and alerts once", () => {
    const { h, run, statusOf, queue } = harness(signedOut(T0));
    const r = queue();
    run(360); // an hour of ticks
    expect(statusOf(r.id)).toBe("queued");
    expect(currentSpawns(h.db)).toHaveLength(0);
    expect(h.typed).toEqual([]);
    expect(h.alerts).toEqual([messages.zh.notify.cliSignedOut.title]);
  });

  it("repeats the alert only every LOGIN_ALERT_EVERY_MS", () => {
    const { h, tick, run, queue } = harness(signedOut(T0));
    queue();
    tick();
    h.clock += LOGIN_ALERT_EVERY_MS - 20_000;
    run(1);
    expect(h.alerts).toHaveLength(1);
    run(1);
    expect(h.alerts).toHaveLength(2);
    run(100);
    expect(h.alerts).toHaveLength(2);
  });

  it("alerts when nothing is queued too: scoring and the next task are stopped all the same", () => {
    const { h, tick } = harness(signedOut(T0));
    tick();
    expect(h.alerts).toHaveLength(1);
  });

  it("keeps the hold across a server restart, without alerting again, until a check answers", () => {
    const { h, tick, run, statusOf, queue } = harness(signedOut(T0));
    const r = queue();
    tick();
    expect(h.alerts).toHaveLength(1);
    h.login = { signedIn: null, at: null }; // restarted: the in-process answer is gone
    run(3);
    expect(currentSpawns(h.db)).toHaveLength(0);
    expect(h.alerts).toHaveLength(1);
    expect(statusOf(r.id)).toBe("queued");
    h.login = signedIn(h.clock);
    run(1);
    expect(currentSpawn(h.db)).toMatchObject({ runId: r.id });
  });

  it("carries on by itself after the sign-in, and alerts for a new outage", () => {
    const { h, tick, run, queue, db } = harness(signedOut(T0));
    const r = queue();
    tick();
    h.login = signedIn(h.clock);
    run(1);
    expect(db.prepare("SELECT 1 FROM profile WHERE key=?").get(LOGIN_HOLD_KEY)).toBeUndefined();
    expect(currentSpawn(h.db)).toMatchObject({ runId: r.id });
    h.login = signedOut(h.clock);
    run(1);
    expect(h.alerts).toHaveLength(2);
  });

  it("does not hold the queue for good on an answer it cannot read", () => {
    const { h, tick, run, queue } = harness(signedOut(T0));
    const r = queue();
    tick();
    h.login = { signedIn: null, at: h.clock };
    run(1);
    expect(currentSpawn(h.db)).toMatchObject({ runId: r.id });
  });

  it("ignores all this for a provider without this login", () => {
    const { h, deps, statusOf, queue, db } = harness(signedOut(T0));
    const r = queue();
    dispatchAttended(db, { ...deps, aiProvider: "codex" });
    expect(h.alerts).toEqual([]);
    expect(currentSpawn(h.db)).toMatchObject({ runId: r.id });
    expect(statusOf(r.id)).toBe("queued");
  });
});

describe("a session that came up signed out", () => {
  // The race the regular check leaves open: the last answer was still "signed in" when the
  // dispatcher spawned, then the session showed the message (#670).
  function spawnedSignedOut() {
    const t = harness(signedIn(T0));
    const r = t.queue();
    expect(t.tick().decision.action).toBe("spawn");
    const pid = (currentSpawn(t.h.db) as { pid: number }).pid;
    t.h.clock += 8_000;
    markSignedOutBanner(pid, t.h.clock);
    return { ...t, r, pid };
  }

  it("waits for a check newer than the message: not replaced, not joined by another, told nothing", () => {
    const { h, tick, pid, queue } = spawnedSignedOut();
    queue(); // room for a second session, and a run to give it
    tick();
    expect(currentSpawn(h.db)?.signedOutAt).toBeTruthy();
    h.clock += 60_000;
    tick();
    expect(h.killed).toEqual([]);
    expect(currentSpawns(h.db).map((s) => s.pid)).toEqual([pid]);
    expect(h.typed).toEqual([]);
  });

  it("is held until the user signs in, then replaced by a fresh session, with the run still queued", () => {
    const { h, tick, run, statusOf, r, pid, db } = spawnedSignedOut();
    tick();
    h.login = signedOut(h.clock + 1);
    run(1080); // three hours: the 11-03 incident typed ~90 reminders over this
    expect(h.alerts).toHaveLength(1);
    expect(h.typed).toEqual([]);
    expect(h.killed).toEqual([]);
    expect(statusOf(r.id)).toBe("queued");
    // A session that wakes up by itself is not handed the run either.
    expect(claimNextRun(db, U, "user_chrome", undefined, currentSpawn(db))).toBeNull();
    expect(statusOf(r.id)).toBe("queued");

    h.login = signedIn(h.clock + 1); // the user ran the login
    h.clock += 10_000;
    expect(tick().decision).toMatchObject({ action: "reap", pid });
    expect(h.killed).toEqual([pid]);
    expect(statusOf(r.id)).toBe("queued");
    const fresh = tick();
    expect(fresh.spawned).toBeDefined();
    expect(fresh.spawned?.pid).not.toBe(pid);
    expect(fresh.spawned?.signedOutAt ?? null).toBeNull();
    expect(claimNextRun(db, U, "user_chrome", undefined, currentSpawn(db))).toMatchObject({ id: r.id });
  });

  it("goes without the idle shutdown notice: it has no tabs to close", () => {
    const { h, tick, r, pid, db } = spawnedSignedOut();
    tick();
    db.prepare("UPDATE executor_runs SET status='stopped' WHERE id=?").run(r.id);
    tick(); // idle from here on
    h.login = signedIn(h.clock + 1);
    h.clock += 16 * 60_000;
    tick();
    expect(h.killed).toEqual([pid]);
    expect(h.typed).toEqual([]);
  });

  it("ends in a failed task, not a respawn loop, when the CLI says signed in and sessions still show the message", () => {
    const { h, tick, run, statusOf, r, pid } = spawnedSignedOut();
    let current = pid;
    const replaced: number[] = [];
    for (let i = 0; i < EARLY_EXIT_LIMIT; i++) {
      tick(); // sees the message
      h.login = signedIn(h.clock + 1);
      h.clock += 10_000;
      tick(); // the check says signed in: replaced
      replaced.push(current);
      h.clock += 2 ** i * 60_000 + 1_000;
      tick(); // past the backoff
      const next = currentSpawn(h.db);
      if (!next) break;
      current = next.pid;
      h.clock += 8_000;
      markSignedOutBanner(current, h.clock);
    }
    expect(h.killed).toEqual(replaced);
    expect(replaced).toHaveLength(EARLY_EXIT_LIMIT);
    expect(statusOf(r.id)).toBe("failed");
    run(30);
    expect(currentSpawns(h.db)).toHaveLength(0);
  });
});

describe("a session already on a run when the login goes", () => {
  it("keeps its run and tabs, is left alone meanwhile, and is reminded once the CLI is back", () => {
    const { h, tick, run, statusOf, queue, db } = harness(signedIn(T0));
    const r = queue();
    tick();
    const session = currentSpawn(db);
    expect(claimNextRun(db, U, "user_chrome", undefined, session)).toMatchObject({ id: r.id });
    const pid = (session as { pid: number }).pid;
    h.mtime = h.clock;
    run(6);

    h.login = signedOut(h.clock);
    markSignedOutBanner(pid, h.clock);
    run(1080); // quiet log for three hours: well past the reminders and the wedged-session reap
    expect(h.alerts).toHaveLength(1);
    expect(h.typed).toEqual([]);
    expect(h.killed).toEqual([]);
    expect(statusOf(r.id)).toBe("running");
    expect(currentSpawn(db)?.signedOutAt ?? null).toBeNull();

    h.login = signedIn(h.clock + 1);
    run(1);
    expect(h.killed).toEqual([]);
    expect(h.typed).toHaveLength(1);
    expect(h.typed[0]).toContain(`run ${r.id} is still running`);
  });
});

describe("refreshCliLogin", () => {
  function fake() {
    const db = openDb(":memory:");
    const f = { db, t: T0, asked: 0, answers: [] as ((stdout: string) => void)[] };
    const tick = () =>
      refreshCliLogin(db, {
        now: () => f.t,
        bin: "/fake/claude",
        run: (_bin, done) => {
          f.asked += 1;
          f.answers.push(done);
        },
      });
    return { f, tick };
  }
  const IN = JSON.stringify({ loggedIn: true });
  const OUT = JSON.stringify({ loggedIn: false, authMethod: "none" });

  it("asks once, not on every tick, and every few minutes after that", () => {
    const { f, tick } = fake();
    tick();
    tick(); // still in flight
    expect(f.asked).toBe(1);
    expect(currentCliLogin()).toEqual({ signedIn: null, at: null });
    f.answers[0](IN);
    expect(currentCliLogin()).toEqual({ signedIn: true, at: T0 });
    f.t += LOGIN_CHECK_MS - 1;
    tick();
    expect(f.asked).toBe(1);
    f.t += 1;
    tick();
    expect(f.asked).toBe(2);
  });

  it("asks every minute while signed out, so a sign-in is noticed quickly", () => {
    const { f, tick } = fake();
    tick();
    f.answers[0](OUT);
    expect(currentCliLogin().signedIn).toBe(false);
    f.t += LOGIN_RECHECK_MS - 1;
    tick();
    expect(f.asked).toBe(1);
    f.t += 1;
    tick();
    expect(f.asked).toBe(2);
  });

  it("asks at once when something saw the CLI's message, including during a check already out", () => {
    const { f, tick } = fake();
    tick();
    requestCliLoginCheck();
    f.answers[0](IN);
    tick();
    expect(f.asked).toBe(2);
    f.answers[1](IN);
    tick();
    expect(f.asked).toBe(2);
  });

  it("records a failed or unreadable check as answered, with no verdict", () => {
    const { f, tick } = fake();
    tick();
    f.answers[0]("");
    expect(currentCliLogin()).toEqual({ signedIn: null, at: T0 });
  });

  it("runs nothing for a provider without this login", () => {
    const { f, tick } = fake();
    setAiProvider(f.db, "codex");
    tick();
    expect(f.asked).toBe(0);
  });

  it("reads the status from stdout, whatever the exit code was", () => {
    expect(parseLoginStatus(`{\n  "loggedIn": false,\n  "authMethod": "none"\n}\n`)).toBe(false);
    expect(parseLoginStatus(`{"loggedIn": true, "email": "a@b.c"}`)).toBe(true);
    expect(parseLoginStatus(`{"status": "ok"}`)).toBeNull();
    expect(parseLoginStatus("error: unknown command 'auth'")).toBeNull();
  });
});

describe("the CLI's message", () => {
  it("is recognised in the bytes the TUI really writes", () => {
    const amber = "\x1b[38;2;255;193;7m";
    expect(new SignedOutWatcher().feed(`${amber}⎿ Login expired · Please run /login   `)).toBe(true);
    expect(new SignedOutWatcher().feed(`\x1b[39;1H⎿\x1b[1CLogin expired · Please run /login\x1b[38;2;153;153;153m`)).toBe(true);
    // Spaces drawn as cursor moves, the way the same TUI draws its other text.
    expect(new SignedOutWatcher().feed("Login\x1b[1Cexpired\x1b[1C·\x1b[1CPlease\x1b[1Crun\x1b[1C/login")).toBe(true);
    const split = new SignedOutWatcher();
    expect(split.feed("Login expired · Please ")).toBe(false);
    expect(split.feed("run /login")).toBe(true);
  });

  it("covers what claude -p prints", () => {
    expect(showsSignedOut("Not logged in · Please run /login")).toBe(true);
    expect(showsSignedOut("Failed to authenticate: OAuth session expired and could not be refreshed")).toBe(true);
  });

  it("is not set off by what the terminal echoes from the App", () => {
    const w = new SignedOutWatcher();
    expect(w.feed(buildAttendedPrompt(670, undefined, "tok", "claude"))).toBe(false);
    expect(w.feed(queuedRunNotice(670, "apply"))).toBe(false);
    expect(new SignedOutWatcher().feed("attended CLI: chrome extension not connected (run claude /login, keep Chrome open)")).toBe(false);
    expect(showsSignedOut("Failed to authenticate with Workday, reported as a sign-in card")).toBe(false);
  });

  it("from a spawned terminal marks that session and asks for a check, once", () => {
    const db = openDb(":memory:");
    let onData: (d: string) => void = () => {};
    let onExit: (e: { exitCode: number }) => void = () => {};
    const proc: PtyProcess = {
      pid: 670,
      onData: (cb) => {
        onData = cb;
      },
      onExit: (cb) => {
        onExit = cb;
      },
      write: () => {},
    };
    const pty: PtyModule = { spawn: () => proc };
    spawnAttendedPty({ claudeBin: "c", args: [], cwd: ".", logPath: path.join(tmp(), "attended-670.log"), env: {} }, { pty, now: () => T0 });

    let asked = 0;
    const check = () => refreshCliLogin(db, { now: () => T0, bin: "c", run: (_b, done) => { asked += 1; done("{}"); } });
    check();
    expect(asked).toBe(1);
    onData("Welcome back");
    expect(signedOutBannerAt(670)).toBeNull();
    onData("Login expired · Please run /login");
    expect(signedOutBannerAt(670)).toBe(T0);
    check();
    expect(asked).toBe(2);
    onData("Login expired · Please run /login"); // every redraw
    check();
    expect(asked).toBe(2);
    onExit({ exitCode: 0 });
    expect(signedOutBannerAt(670)).toBeNull();
  });
});

describe("signedOutSummary", () => {
  it("names the sign-out and quotes the CLI", () => {
    const s = signedOutSummary("Failed to authenticate: OAuth session expired and could not be refreshed");
    expect(s).toContain("signed out");
    expect(s).toContain("OAuth session expired");
    expect(signedOutSummary("Not logged in · Please run /login")).toContain("signed out");
  });
  it("says nothing for any other last line", () => {
    expect(signedOutSummary("[18:30:21] finished the batch")).toBeNull();
    expect(signedOutSummary("")).toBeNull();
    expect(signedOutSummary(undefined)).toBeNull();
  });
});
