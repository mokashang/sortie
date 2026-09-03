import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { startExecutor, stopExecutor, executorStatus, reapStaleRuns, hasLiveRun, SpawnedChild, SpawnFn } from "@/executor/runner";

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
});
