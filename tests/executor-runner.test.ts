import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import {
  startExecutor,
  stopExecutor,
  executorStatus,
  reapStaleRuns,
  hasLiveRun,
  hasLiveOrQueuedRun,
  lastRunChannel,
  claimNextRun,
  appendRunLog,
  finishRun,
  SpawnedChild,
  SpawnFn,
} from "@/executor/runner";

// A fake child process that never actually spawns `claude` — the fake spawn function below
// tracks calls and returns one of these so tests can drive/inspect it without touching the
// real filesystem/network or requiring the `claude` CLI to be installed.
class FakeChild implements SpawnedChild {
  pid: number;
  stdin: { write: (chunk: string) => void; end: () => void };
  written = "";
  ended = false;
  private exitListeners: ((code: number | null) => void)[] = [];
  killed = false;

  constructor(pid: number) {
    this.pid = pid;
    this.stdin = {
      write: (chunk: string) => {
        this.written += chunk;
      },
      end: () => {
        this.ended = true;
      },
    };
  }

  on(event: "exit", listener: (code: number | null) => void) {
    this.exitListeners.push(listener);
    return this;
  }

  unref() {
    // no-op for the fake
  }

  emitExit(code: number | null) {
    for (const l of this.exitListeners) l(code);
  }
}

function makeFakeSpawn(pid: number) {
  const child = new FakeChild(pid);
  const spawnFn = vi.fn<SpawnFn>((_bin, _args, _opts) => child);
  return { spawnFn, child };
}

describe("executor/runner", () => {
  let db: DB;
  let tmpLogDir: string;

  beforeEach(() => {
    db = openDb(":memory:");
    tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobseeker-executor-logs-"));
  });

  afterEach(() => {
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });

  describe("startExecutor", () => {
    it("creates a running row with pid + log_path, and writes the prompt to stdin", () => {
      const { spawnFn, child } = makeFakeSpawn(process.pid); // use our own pid: guaranteed "alive"
      const result = startExecutor(db, "apply", { limit: 3 }, { spawn: spawnFn, logDir: tmpLogDir });

      expect(result.id).toBeGreaterThan(0);
      expect(result.pid).toBe(process.pid);
      expect(result.logPath).toContain(`run-${result.id}.log`);
      expect(fs.existsSync(result.logPath)).toBe(true);

      const row = db.prepare("SELECT * FROM executor_runs WHERE id=?").get(result.id) as Record<string, unknown>;
      expect(row.kind).toBe("apply");
      expect(row.status).toBe("running");
      expect(row.pid).toBe(process.pid);
      expect(row.log_path).toBe(result.logPath);
      expect(JSON.parse(row.options as string)).toEqual({ limit: 3 });

      expect(spawnFn).toHaveBeenCalledTimes(1);
      const [bin, args] = spawnFn.mock.calls[0];
      expect(args).toContain("-p");
      expect(args).toContain("--allowedTools");
      expect(child.written).toContain("apply"); // the built apply prompt landed on stdin
      expect(child.ended).toBe(true);
    });

    it("refuses to start a duplicate kind while one is already running", () => {
      const { spawnFn: spawn1 } = makeFakeSpawn(process.pid);
      startExecutor(db, "apply", {}, { spawn: spawn1, logDir: tmpLogDir });

      const { spawnFn: spawn2 } = makeFakeSpawn(process.pid);
      expect(() => startExecutor(db, "apply", {}, { spawn: spawn2, logDir: tmpLogDir })).toThrow(/already/i);
      expect(spawn2).not.toHaveBeenCalled();
    });

    it("allows a different kind to start concurrently", () => {
      const { spawnFn: spawn1 } = makeFakeSpawn(process.pid);
      startExecutor(db, "apply", {}, { spawn: spawn1, logDir: tmpLogDir });

      const { spawnFn: spawn2 } = makeFakeSpawn(process.pid);
      expect(() => startExecutor(db, "network_send", {}, { spawn: spawn2, logDir: tmpLogDir })).not.toThrow();
    });

    it("reclaims a duplicate-kind slot whose pid is dead and proceeds", () => {
      const deadPid = 999999; // astronomically unlikely to be a live pid
      const { spawnFn: spawn1 } = makeFakeSpawn(deadPid);
      const first = startExecutor(db, "apply", {}, { spawn: spawn1, logDir: tmpLogDir });

      const { spawnFn: spawn2 } = makeFakeSpawn(process.pid);
      const second = startExecutor(db, "apply", {}, { spawn: spawn2, logDir: tmpLogDir });
      expect(second.id).not.toBe(first.id);

      const firstRow = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(first.id) as { status: string };
      expect(firstRow.status).toBe("failed");
    });

    it("updates status to done/failed on child exit", () => {
      const { spawnFn, child } = makeFakeSpawn(process.pid);
      const result = startExecutor(db, "apply", {}, { spawn: spawnFn, logDir: tmpLogDir });

      child.emitExit(0);
      const rowOk = db.prepare("SELECT status, ended_at FROM executor_runs WHERE id=?").get(result.id) as {
        status: string;
        ended_at: string | null;
      };
      expect(rowOk.status).toBe("done");
      expect(rowOk.ended_at).not.toBeNull();
    });

    it("marks the run failed on a nonzero exit code", () => {
      const { spawnFn, child } = makeFakeSpawn(process.pid);
      const result = startExecutor(db, "network_find", {}, { spawn: spawnFn, logDir: tmpLogDir });

      child.emitExit(1);
      const row = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(result.id) as { status: string };
      expect(row.status).toBe("failed");
    });

    it("starts a headless jd_review run and pipes the jd_review prompt to stdin", () => {
      const { spawnFn, child } = makeFakeSpawn(process.pid);
      const r = startExecutor(db, "jd_review", { limit: 40 }, { spawn: spawnFn, logDir: tmpLogDir }, "headless");
      expect(r.pid).toBe(process.pid);
      expect(child.written).toContain("/api/jd-review/batch?limit=40");
      const row = db.prepare("SELECT kind, channel FROM executor_runs WHERE id=?").get(r.id) as any;
      expect(row).toEqual({ kind: "jd_review", channel: "headless" });
    });
  });

  describe("stopExecutor", () => {
    it("marks a running row stopped and attempts to kill the process group", () => {
      const { spawnFn } = makeFakeSpawn(process.pid);
      const result = startExecutor(db, "apply", {}, { spawn: spawnFn, logDir: tmpLogDir });

      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
      stopExecutor(db, result.id);

      // Assert on the spy BEFORE restoring — mockRestore() also clears recorded call history
      // (it's mockReset() + restore-original), so asserting after restore would always fail.
      expect(killSpy).toHaveBeenCalled();
      killSpy.mockRestore();

      const row = db.prepare("SELECT status, ended_at FROM executor_runs WHERE id=?").get(result.id) as {
        status: string;
        ended_at: string | null;
      };
      expect(row.status).toBe("stopped");
      expect(row.ended_at).not.toBeNull();
    });

    it("throws for an unknown run id", () => {
      expect(() => stopExecutor(db, 999)).toThrow();
    });

    it("throws when the run is not currently running", () => {
      const { spawnFn, child } = makeFakeSpawn(process.pid);
      const result = startExecutor(db, "apply", {}, { spawn: spawnFn, logDir: tmpLogDir });
      child.emitExit(0);
      expect(() => stopExecutor(db, result.id)).toThrow(/not running/i);
    });
  });

  describe("reapStaleRuns", () => {
    it("marks running rows with a dead pid as failed with a 'process gone' summary", () => {
      db.prepare(
        "INSERT INTO executor_runs (kind, status, pid, log_path) VALUES ('apply','running', 999999, '/tmp/x.log')"
      ).run();

      reapStaleRuns(db);

      const row = db.prepare("SELECT status, summary FROM executor_runs WHERE kind='apply'").get() as {
        status: string;
        summary: string;
      };
      expect(row.status).toBe("failed");
      expect(row.summary).toMatch(/process gone/);
    });

    it("leaves a running row alone when its pid is alive", () => {
      db.prepare("INSERT INTO executor_runs (kind, status, pid, log_path) VALUES ('apply','running', ?, '/tmp/x.log')").run(
        process.pid
      );

      reapStaleRuns(db);

      const row = db.prepare("SELECT status FROM executor_runs WHERE kind='apply'").get() as { status: string };
      expect(row.status).toBe("running");
    });

    it("leaves done/failed/stopped rows untouched", () => {
      db.prepare("INSERT INTO executor_runs (kind, status, pid, log_path) VALUES ('apply','done', 999999, '/tmp/x.log')").run();
      reapStaleRuns(db);
      const row = db.prepare("SELECT status FROM executor_runs WHERE kind='apply'").get() as { status: string };
      expect(row.status).toBe("done");
    });
  });

  describe("hasLiveRun", () => {
    it("is false when there is no running row of that kind", () => {
      expect(hasLiveRun(db, "apply")).toBe(false);
    });

    it("is true when a running row of that kind has a live pid", () => {
      db.prepare(
        "INSERT INTO executor_runs (kind, status, pid, log_path) VALUES ('apply','running', ?, '/tmp/x.log')"
      ).run(process.pid);
      expect(hasLiveRun(db, "apply")).toBe(true);
    });

    it("is false when the only running row of that kind has a dead pid", () => {
      db.prepare(
        "INSERT INTO executor_runs (kind, status, pid, log_path) VALUES ('apply','running', 999999, '/tmp/x.log')"
      ).run();
      expect(hasLiveRun(db, "apply")).toBe(false);
    });

    it("does not count a running row of a different kind", () => {
      db.prepare(
        "INSERT INTO executor_runs (kind, status, pid, log_path) VALUES ('network_send','running', ?, '/tmp/x.log')"
      ).run(process.pid);
      expect(hasLiveRun(db, "apply")).toBe(false);
    });

    it("does not count a done/failed/stopped row even with a live-looking pid", () => {
      db.prepare(
        "INSERT INTO executor_runs (kind, status, pid, log_path) VALUES ('apply','done', ?, '/tmp/x.log')"
      ).run(process.pid);
      expect(hasLiveRun(db, "apply")).toBe(false);
    });
  });

  describe("executorStatus", () => {
    it("lists recent runs (most recent first) up to 10, and tails the log for running ones", () => {
      const { spawnFn } = makeFakeSpawn(process.pid);
      const result = startExecutor(db, "apply", { limit: 2 }, { spawn: spawnFn, logDir: tmpLogDir });
      fs.appendFileSync(result.logPath, "line1\nline2\nline3\n");

      const rows = executorStatus(db);
      expect(rows.length).toBeGreaterThan(0);
      const row = rows.find((r) => r.id === result.id)!;
      expect(row.kind).toBe("apply");
      expect(row.status).toBe("running");
      expect(row.logTail).toBeDefined();
      expect(row.logTail!.join("\n")).toContain("line3");
    });

    it("reaps stale runs before listing", () => {
      db.prepare("INSERT INTO executor_runs (kind, status, pid, log_path) VALUES ('apply','running', 999999, '/tmp/x.log')").run();
      const rows = executorStatus(db);
      const row = rows.find((r) => r.kind === "apply")!;
      expect(row.status).toBe("failed");
    });
  });

  describe("user_chrome channel", () => {
    it("startExecutor(..., 'user_chrome') queues a row with no spawn, pid NULL, and an empty log file", () => {
      const { spawnFn } = makeFakeSpawn(process.pid);
      const result = startExecutor(db, "apply", { resume: true }, { spawn: spawnFn, logDir: tmpLogDir }, "user_chrome");

      expect(spawnFn).not.toHaveBeenCalled();
      expect(result.pid).toBeNull();
      expect(fs.existsSync(result.logPath)).toBe(true);
      expect(fs.readFileSync(result.logPath, "utf8")).toBe("");

      const row = db.prepare("SELECT * FROM executor_runs WHERE id=?").get(result.id) as Record<string, unknown>;
      expect(row.status).toBe("queued");
      expect(row.channel).toBe("user_chrome");
      expect(row.pid).toBeNull();
      expect(row.log_path).toBe(result.logPath);
    });

    it("refuses a duplicate user_chrome start while one of the same kind is queued", () => {
      startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
      expect(() => startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome")).toThrow(/already/i);
    });

    it("refuses a duplicate user_chrome start while one of the same kind is running (claimed)", () => {
      const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
      claimNextRun(db, "user_chrome");
      expect(queued).toBeTruthy();
      expect(() => startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome")).toThrow(/already/i);
    });

    it("headless and user_chrome runs of the same kind do not block each other", () => {
      const { spawnFn } = makeFakeSpawn(process.pid);
      expect(() => startExecutor(db, "apply", {}, { spawn: spawnFn, logDir: tmpLogDir }, "headless")).not.toThrow();
      expect(() => startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome")).not.toThrow();
    });

    describe("claimNextRun", () => {
      it("returns null when nothing is queued", () => {
        expect(claimNextRun(db, "user_chrome")).toBeNull();
      });

      it("claims the oldest queued run of the channel, marks it running, and returns its shape", () => {
        const first = startExecutor(db, "apply", { limit: 2 }, { logDir: tmpLogDir }, "user_chrome");
        const second = startExecutor(db, "network_send", {}, { logDir: tmpLogDir }, "user_chrome");

        const claimed = claimNextRun(db, "user_chrome");
        expect(claimed).not.toBeNull();
        expect(claimed!.id).toBe(first.id);
        expect(claimed!.kind).toBe("apply");
        expect(claimed!.options).toEqual({ limit: 2 });
        expect(claimed!.logPath).toBe(first.logPath);

        const row = db.prepare("SELECT status, claimed_at FROM executor_runs WHERE id=?").get(first.id) as {
          status: string;
          claimed_at: string | null;
        };
        expect(row.status).toBe("running");
        expect(row.claimed_at).not.toBeNull();

        // second run is still queued — untouched by claiming the first
        const secondRow = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(second.id) as {
          status: string;
        };
        expect(secondRow.status).toBe("queued");
      });

      it("does not claim a headless run even if it were (hypothetically) queued", () => {
        db.prepare(
          "INSERT INTO executor_runs (kind, status, channel, options, log_path) VALUES ('apply','queued','headless','{}','/tmp/x.log')"
        ).run();
        expect(claimNextRun(db, "user_chrome")).toBeNull();
      });
    });

    describe("appendRunLog", () => {
      it("appends a timestamped line to the run's log file", () => {
        const result = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        appendRunLog(db, result.id, "opened Workday tab");

        const content = fs.readFileSync(result.logPath, "utf8");
        expect(content).toMatch(/^\[\d{2}:\d{2}:\d{2}\] opened Workday tab\n$/);

        appendRunLog(db, result.id, "filled form");
        const content2 = fs.readFileSync(result.logPath, "utf8");
        expect(content2).toContain("opened Workday tab");
        expect(content2).toContain("filled form");
      });

      it("throws for an unknown run id", () => {
        expect(() => appendRunLog(db, 999, "x")).toThrow();
      });
    });

    describe("finishRun", () => {
      it("transitions a running run to done with a summary", () => {
        const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        claimNextRun(db, "user_chrome");
        finishRun(db, queued.id, "done", "submitted 3 applications");

        const row = db.prepare("SELECT status, summary, ended_at FROM executor_runs WHERE id=?").get(queued.id) as {
          status: string;
          summary: string | null;
          ended_at: string | null;
        };
        expect(row.status).toBe("done");
        expect(row.summary).toBe("submitted 3 applications");
        expect(row.ended_at).not.toBeNull();
      });

      it("transitions a still-queued run to failed (attended session claimed it out of band, e.g. crashed before claiming)", () => {
        const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        finishRun(db, queued.id, "failed", "extension disconnected");

        const row = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(queued.id) as { status: string };
        expect(row.status).toBe("failed");
      });

      it("throws when finishing an already-terminal run", () => {
        const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        claimNextRun(db, "user_chrome");
        finishRun(db, queued.id, "done");
        expect(() => finishRun(db, queued.id, "failed")).toThrow();
      });

      it("throws for an unknown run id", () => {
        expect(() => finishRun(db, 999, "done")).toThrow();
      });
    });

    describe("stopExecutor on user_chrome rows", () => {
      it("marks a queued run stopped without touching process.kill", () => {
        const killSpy = vi.spyOn(process, "kill");
        const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        stopExecutor(db, queued.id);
        expect(killSpy).not.toHaveBeenCalled();
        killSpy.mockRestore();

        const row = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(queued.id) as { status: string };
        expect(row.status).toBe("stopped");
      });

      it("marks a running (claimed) run stopped without touching process.kill", () => {
        const killSpy = vi.spyOn(process, "kill");
        const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        claimNextRun(db, "user_chrome");
        stopExecutor(db, queued.id);
        expect(killSpy).not.toHaveBeenCalled();
        killSpy.mockRestore();

        const row = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(queued.id) as { status: string };
        expect(row.status).toBe("stopped");
      });
    });

    describe("reapStaleRuns for user_chrome", () => {
      it("leaves a fresh user_chrome running run alone", () => {
        const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        claimNextRun(db, "user_chrome");

        const now = Date.now();
        reapStaleRuns(db, { now: () => now, mtime: () => now - 60_000 }); // 1 minute old

        const row = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(queued.id) as { status: string };
        expect(row.status).toBe("running");
      });

      it("fails a user_chrome running run whose log hasn't been touched in 20+ minutes", () => {
        const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        claimNextRun(db, "user_chrome");

        const now = Date.now();
        reapStaleRuns(db, { now: () => now, mtime: () => now - 21 * 60_000 });

        const row = db.prepare("SELECT status, summary FROM executor_runs WHERE id=?").get(queued.id) as {
          status: string;
          summary: string | null;
        };
        expect(row.status).toBe("failed");
        expect(row.summary).toMatch(/session gone/);
      });

      it("does not apply pid-liveness checks to user_chrome rows (pid is NULL)", () => {
        const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        claimNextRun(db, "user_chrome");

        // No mtime override needed — a fresh log file (just created) is well within the window,
        // and a NULL pid would otherwise look "dead" under the headless isAlive() check.
        reapStaleRuns(db);

        const row = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(queued.id) as { status: string };
        expect(row.status).toBe("running");
      });

      it("still reaps a stale headless run and ignores a fresh user_chrome one in the same pass", () => {
        db.prepare(
          "INSERT INTO executor_runs (kind, status, channel, pid, log_path) VALUES ('network_send','running','headless', 999999, '/tmp/x.log')"
        ).run();
        const queued = startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
        claimNextRun(db, "user_chrome");

        reapStaleRuns(db);

        const headlessRow = db.prepare("SELECT status FROM executor_runs WHERE kind='network_send'").get() as {
          status: string;
        };
        expect(headlessRow.status).toBe("failed");
        const chromeRow = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(queued.id) as {
          status: string;
        };
        expect(chromeRow.status).toBe("running");
      });
    });
  });

  describe("hasLiveOrQueuedRun", () => {
    it("is true for a queued user_chrome run even though it has no pid", () => {
      startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
      expect(hasLiveOrQueuedRun(db, "apply")).toBe(true);
    });

    it("is true for a live headless running run", () => {
      const { spawnFn } = makeFakeSpawn(process.pid);
      startExecutor(db, "apply", {}, { spawn: spawnFn, logDir: tmpLogDir }, "headless");
      expect(hasLiveOrQueuedRun(db, "apply")).toBe(true);
    });

    it("is false when there's nothing queued or running", () => {
      expect(hasLiveOrQueuedRun(db, "apply")).toBe(false);
    });

    it("is true for a claimed (running) user_chrome run even though it has no pid", () => {
      startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
      const claimed = claimNextRun(db, "user_chrome");
      expect(claimed).not.toBeNull();
      expect(hasLiveOrQueuedRun(db, "apply")).toBe(true);
      finishRun(db, claimed!.id, "done");
      expect(hasLiveOrQueuedRun(db, "apply")).toBe(false);
    });
  });

  describe("lastRunChannel", () => {
    it("is null when there's no prior run of that kind", () => {
      expect(lastRunChannel(db, "apply")).toBeNull();
    });

    it("returns the channel of the most recent run of that kind", () => {
      const { spawnFn } = makeFakeSpawn(process.pid);
      startExecutor(db, "apply", {}, { spawn: spawnFn, logDir: tmpLogDir }, "headless");
      startExecutor(db, "apply", {}, { logDir: tmpLogDir }, "user_chrome");
      expect(lastRunChannel(db, "apply")).toBe("user_chrome");
    });
  });
});

describe("executor/runner referral mode", () => {
  it("headless refuses referral-mode plans/options; user_chrome accepts them", () => {
    const db = openDb(":memory:");
    const tmpLogDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobseeker-executor-logs-"));
    const { spawnFn } = makeFakeSpawn(4242);
    expect(() =>
      startExecutor(
        db,
        "apply",
        { plan: [{ direction: "swe_general", count: 1, mode: "referral" }] },
        { spawn: spawnFn, logDir: tmpLogDir },
        "headless"
      )
    ).toThrow(/值守会话/);
    expect(() => startExecutor(db, "apply", { jobIds: [1], mode: "referral" }, { spawn: spawnFn, logDir: tmpLogDir }, "headless")).toThrow(
      /值守会话/
    );
    expect(spawnFn).not.toHaveBeenCalled();
    const r = startExecutor(db, "apply", { jobIds: [1, 2], mode: "referral" }, { logDir: tmpLogDir }, "user_chrome");
    const row = db.prepare("SELECT options, status FROM executor_runs WHERE id = ?").get(r.id) as { options: string; status: string };
    expect(row.status).toBe("queued");
    expect(JSON.parse(row.options)).toEqual({ jobIds: [1, 2], mode: "referral" });
    fs.rmSync(tmpLogDir, { recursive: true, force: true });
  });
});
