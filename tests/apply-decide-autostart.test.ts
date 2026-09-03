import { describe, it, expect, vi } from "vitest";
import { openDb, DB } from "@/lib/db";
import { decideAndMaybeAutoStart } from "@/apply/decide-auto-start";

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
  it("approve with no live executor auto-starts one in resume mode and reports autoStarted+runId", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveRun = vi.fn(() => false);
    const startExecutor = vi.fn(() => ({ id: 42, pid: 123, logPath: "/tmp/run-42.log" }));

    const result = decideAndMaybeAutoStart(db, jobId, "approve", undefined, { hasLiveRun, startExecutor });

    expect(result).toEqual({ autoStarted: true, runId: 42 });
    expect(hasLiveRun).toHaveBeenCalledWith(db, "apply");
    expect(startExecutor).toHaveBeenCalledWith(db, "apply", { resume: true });

    const row = db.prepare("SELECT confirm_decision FROM applications WHERE job_id=?").get(jobId) as {
      confirm_decision: string;
    };
    expect(row.confirm_decision).toBe("approved");
  });

  it("approve with a live executor already running does not auto-start", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveRun = vi.fn(() => true);
    const startExecutor = vi.fn(() => ({ id: 1, pid: 1, logPath: "" }));

    const result = decideAndMaybeAutoStart(db, jobId, "approve", undefined, { hasLiveRun, startExecutor });

    expect(result).toEqual({ autoStarted: false });
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("reject never checks liveness or auto-starts", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveRun = vi.fn(() => false);
    const startExecutor = vi.fn(() => ({ id: 1, pid: 1, logPath: "" }));

    const result = decideAndMaybeAutoStart(db, jobId, "reject", "not a fit", { hasLiveRun, startExecutor });

    expect(result).toEqual({ autoStarted: false });
    expect(hasLiveRun).not.toHaveBeenCalled();
    expect(startExecutor).not.toHaveBeenCalled();
  });

  it("a spawn failure in startExecutor never breaks the approve itself", () => {
    const db = openDb(":memory:");
    const jobId = seedAwaitingConfirm(db);

    const hasLiveRun = vi.fn(() => false);
    const startExecutor = vi.fn(() => {
      throw new Error("spawn ENOENT");
    });

    const result = decideAndMaybeAutoStart(db, jobId, "approve", undefined, { hasLiveRun, startExecutor });

    expect(result).toEqual({ autoStarted: false });
    // The approve itself still went through despite the spawn failure.
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
      decideAndMaybeAutoStart(db, jobId, "bogus", undefined, {})
    ).toThrow();
  });
});
