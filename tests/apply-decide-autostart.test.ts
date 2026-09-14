import { describe, it, expect, vi } from "vitest";
import { openDb, DB } from "@/lib/db";
import { decideAndMaybeAutoStart } from "@/apply/decide-auto-start";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

function seedAwaitingConfirm(db: DB): number {
  const jobId = db
    .prepare(
      "INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(`fp-${Math.random()}`, "Acme", "SWE", "https://acme.example/apply", "greenhouse", "manual", "2026-01-01 00:00:00")
    .lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "ai_infra", 80, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(jobId, "awaiting_confirm");
  return jobId;
}

describe("decideAndMaybeAutoStart", () => {
  it("approve with no prior apply run at all auto-starts on the default user_chrome channel", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const lastRunChannel = vi.fn(() => null);
    const startExecutor = vi.fn(() => ({ id: 42, pid: null, logPath: "/tmp/run-42.log" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: true, runId: 42, channel: "user_chrome" });
    expect(hasLiveOrQueuedRun).toHaveBeenCalledWith(db, U, "apply");
    expect(lastRunChannel).toHaveBeenCalledWith(db, U, "apply");
    expect(startExecutor).toHaveBeenCalledWith(db, U, "apply", { resume: true }, {}, "user_chrome");

    const row = db.prepare("SELECT confirm_decision FROM applications WHERE job_id=?").get(jobId) as {
      confirm_decision: string;
    };
    expect(row.confirm_decision).toBe("approved");
  });

  it("approve follows the last apply run's channel when it was user_chrome", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const lastRunChannel = vi.fn(() => "user_chrome" as const);
    const startExecutor = vi.fn(() => ({ id: 7, pid: null, logPath: "/tmp/run-7.log" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: true, runId: 7, channel: "user_chrome" });
    expect(startExecutor).toHaveBeenCalledWith(db, U, "apply", { resume: true }, {}, "user_chrome");
  });

  it("approve follows the last apply run's channel when it was headless", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const lastRunChannel = vi.fn(() => "headless" as const);
    const startExecutor = vi.fn(() => ({ id: 8, pid: 123, logPath: "/tmp/run-8.log" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: true, runId: 8, channel: "headless" });
    expect(startExecutor).toHaveBeenCalledWith(db, U, "apply", { resume: true }, {}, "headless");
  });

  it("approve with a live or queued executor already does not auto-start", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => true);
    const lastRunChannel = vi.fn(() => "user_chrome" as const);
    const startExecutor = vi.fn(() => ({ id: 1, pid: 1, logPath: "" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("reject never checks liveness or auto-starts", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const startExecutor = vi.fn(() => ({ id: 1, pid: 1, logPath: "" }));

    const result = decideAndMaybeAutoStart(db, U, jobId, "reject", "not a fit", { hasLiveOrQueuedRun, startExecutor });

    expect(result).toEqual({ autoStarted: false });
    expect(hasLiveOrQueuedRun).not.toHaveBeenCalled();
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("a start/enqueue failure never breaks the approve itself", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveOrQueuedRun = vi.fn(() => false);
    const lastRunChannel = vi.fn(() => null);
    const startExecutor = vi.fn(() => {
      throw new Error("spawn ENOENT");
    });

    const result = decideAndMaybeAutoStart(db, U, jobId, "approve", undefined, {
      hasLiveOrQueuedRun,
      lastRunChannel,
      startExecutor,
    });

    expect(result).toEqual({ autoStarted: false });
    // The approve itself still went through despite the failure.
    const row = db.prepare("SELECT confirm_decision FROM applications WHERE job_id=?").get(jobId) as {
      confirm_decision: string;
    };
    expect(row.confirm_decision).toBe("approved");
  });

  it("an invalid decision still throws (decide()'s own validation is not swallowed)", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    expect(() =>
      // @ts-expect-error deliberately invalid decision value for the test
      decideAndMaybeAutoStart(db, U, jobId, "bogus", undefined, {})
    ).toThrow();
  });
});
