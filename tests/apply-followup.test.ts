import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { startExecutor, claimNextRun, finishRun } from "@/executor/runner";
import { queueTargetedRun, askingRunAlive, reclaimStrandedPrepared } from "@/apply/followup";
import { maybeAutoStartApply } from "@/apply/decide-auto-start";
import { pendingInfo } from "@/apply/info";

// A resolved 待处理 card must become work even while the assistant is busy (2026-09-17): the
// job is merged into a queued targeted run or queued behind the running one, never dropped into
// the general pool. And a job taken by a run that ended without reporting is reclaimed — with a
// targeted run when the user had answered its questions.

const U = "legacy";
function openTestDb(): { db: DB; logDir: string } {
  const db = openDb(":memory:");
  seedOwner(db, U);
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "followup-"));
  return { db, logDir };
}
function seedJob(db: DB, status = "matched", extra: { infoAnswers?: Record<string, string>; runId?: number | null } = {}): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, "Acme", "SWE", "https://boards.greenhouse.io/acme/jobs/1", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "swe_general", 85, 1);
  db.prepare("INSERT INTO applications (job_id, status, info_answers, run_id) VALUES (?,?,?,?)").run(
    jobId,
    status,
    extra.infoAnswers ? JSON.stringify(extra.infoAnswers) : null,
    extra.runId ?? null
  );
  return jobId;
}
const runRow = (db: DB, id: number) =>
  db.prepare("SELECT status, options, channel FROM executor_runs WHERE id = ?").get(id) as { status: string; options: string; channel: string };
const app = (db: DB, id: number) => db.prepare("SELECT * FROM applications WHERE job_id = ?").get(id) as Record<string, unknown>;

describe("queueTargetedRun", () => {
  it("queues a targeted user_chrome run when nothing is running", () => {
    const { db, logDir } = openTestDb();
    const r = queueTargetedRun(db, U, [11, 12], "direct", { logDir });
    expect(r).toMatchObject({ autoStarted: true, channel: "user_chrome" });
    expect(runRow(db, r.runId!)).toMatchObject({ status: "queued", channel: "user_chrome" });
    expect(JSON.parse(runRow(db, r.runId!).options)).toEqual({ jobIds: [11, 12], mode: "direct" });
  });

  it("queues behind a running attended run instead of standing down", () => {
    const { db, logDir } = openTestDb();
    const plan = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 5, mode: "direct" }] }, { logDir }, "user_chrome");
    expect(claimNextRun(db, U, "user_chrome")?.id).toBe(plan.id);
    expect(runRow(db, plan.id).status).toBe("running");
    // The plain start guard still refuses a second run of the channel...
    expect(() => startExecutor(db, U, "apply", { jobIds: [7] }, { logDir }, "user_chrome")).toThrow(/already in progress/);
    // ...but the follow-up goes in behind it, and is what the session claims next.
    const r = queueTargetedRun(db, U, [7], "direct", { logDir });
    expect(r.autoStarted).toBe(true);
    expect(runRow(db, r.runId!).status).toBe("queued");
    finishRun(db, U, plan.id, "done");
    expect(claimNextRun(db, U, "user_chrome")?.id).toBe(r.runId);
  });

  it("merges into a queued targeted run of the same mode, never into a plan or the other mode", () => {
    const { db, logDir } = openTestDb();
    const first = queueTargetedRun(db, U, [1, 2], "direct", { logDir });
    const second = queueTargetedRun(db, U, [2, 3], "direct", { logDir });
    expect(second).toMatchObject({ autoStarted: true, runId: first.runId, merged: true });
    expect(JSON.parse(runRow(db, first.runId!).options).jobIds).toEqual([1, 2, 3]);
    const referral = queueTargetedRun(db, U, [4], "referral", { logDir });
    expect(referral.merged).toBeUndefined();
    expect(referral.runId).not.toBe(first.runId);
    expect(JSON.parse(runRow(db, referral.runId!).options)).toEqual({ jobIds: [4], mode: "referral" });
  });

  it("maybeAutoStartApply hands every jobIds run to it (the card routes and the referral board)", () => {
    const { db, logDir } = openTestDb();
    const plan = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 5, mode: "direct" }] }, { logDir }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    const r = maybeAutoStartApply(db, U, { jobIds: [9], mode: "direct" }, { logDir });
    expect(r.autoStarted).toBe(true);
    expect(r.runId).not.toBe(plan.id);
    expect(runRow(db, r.runId!).status).toBe("queued");
    // The bare resume run still stands down for a live run.
    expect(maybeAutoStartApply(db, U, { resume: true }, { logDir })).toEqual({ autoStarted: false });
  });

  it("drops junk ids and never throws", () => {
    const { db, logDir } = openTestDb();
    expect(queueTargetedRun(db, U, [0, -1, NaN], "direct", { logDir })).toEqual({ autoStarted: false });
    const failing = () => {
      throw new Error("boom");
    };
    expect(queueTargetedRun(db, U, [5], "direct", { logDir, startExecutor: failing as never })).toEqual({ autoStarted: false });
  });
});

describe("askingRunAlive", () => {
  it("is true only while the run that took the job is running", () => {
    const { db, logDir } = openTestDb();
    const run = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 1, mode: "direct" }] }, { logDir }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    const mine = seedJob(db, "needs_info", { runId: run.id });
    const orphan = seedJob(db, "needs_info", { runId: null });
    expect(askingRunAlive(db, U, mine)).toBe(true);
    expect(askingRunAlive(db, U, orphan)).toBe(false);
    finishRun(db, U, run.id, "failed", "session gone");
    // Another run of the account being alive changes nothing for a job it did not take.
    startExecutor(db, U, "apply", { jobIds: [orphan], mode: "direct" }, { logDir }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    expect(askingRunAlive(db, U, mine)).toBe(false);
  });
});

describe("reclaimStrandedPrepared", () => {
  it("returns rows of a dead run to the queue and requeues the answered ones as one targeted run", () => {
    const { db, logDir } = openTestDb();
    const dead = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 5, mode: "direct" }] }, { logDir }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    finishRun(db, U, dead.id, "failed", "session gone");
    const answered = seedJob(db, "prepared", { runId: dead.id, infoAnswers: { gpa: "3.3" } });
    const answered2 = seedJob(db, "prepared", { runId: dead.id, infoAnswers: { transcript: "/x.pdf" } });
    const plain = seedJob(db, "prepared", { runId: dead.id });
    const r = reclaimStrandedPrepared(db, U, { logDir });
    expect(r.reclaimed.sort()).toEqual([answered, answered2, plain].sort());
    expect(r.requeued.sort()).toEqual([answered, answered2].sort());
    expect(r.parked).toEqual([]);
    expect(app(db, answered).status).toBe("matched");
    expect(app(db, plain).status).toBe("matched");
    expect(JSON.parse(app(db, answered).info_answers as string)).toEqual({ gpa: "3.3" });
    expect(r.followup?.autoStarted).toBe(true);
    expect(JSON.parse(runRow(db, r.followup!.runId!).options)).toEqual({ jobIds: [answered, answered2].sort((a, b) => a - b), mode: "direct" });
    // Idempotent: nothing left to reclaim, nothing queued twice.
    expect(reclaimStrandedPrepared(db, U, { logDir }).reclaimed).toEqual([]);
  });

  it("leaves rows of a running run alone, and fresh rows with no run", () => {
    const { db, logDir } = openTestDb();
    const live = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 5, mode: "direct" }] }, { logDir }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    const mine = seedJob(db, "prepared", { runId: live.id, infoAnswers: { gpa: "3.3" } });
    const fresh = seedJob(db, "prepared", { runId: null });
    expect(reclaimStrandedPrepared(db, U, { logDir }).reclaimed).toEqual([]);
    expect(app(db, mine).status).toBe("prepared");
    expect(app(db, fresh).status).toBe("prepared");
    // A run-less row is only stranded once it is old (the updated_at trigger resets any UPDATE,
    // so the old row is inserted old).
    const oldJob = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
      .run("fp-old", "Acme", "SWE", "https://boards.greenhouse.io/acme/jobs/2", "manual").lastInsertRowid as number;
    db.prepare("INSERT INTO applications (job_id, status, updated_at) VALUES (?, 'prepared', '2020-01-01 00:00:00')").run(oldJob);
    expect(reclaimStrandedPrepared(db, U, { logDir }).reclaimed).toEqual([oldJob]);
  });

  it("an answered row a targeted run already dropped becomes a card, not another silent retry", () => {
    const { db, logDir } = openTestDb();
    const jobId = seedJob(db, "matched", { infoAnswers: { gpa: "3.3" } });
    const targeted = startExecutor(db, U, "apply", { jobIds: [jobId], mode: "direct" }, { logDir }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    db.prepare("UPDATE applications SET status = 'prepared', run_id = ? WHERE job_id = ?").run(targeted.id, jobId);
    finishRun(db, U, targeted.id, "done");
    const r = reclaimStrandedPrepared(db, U, { logDir });
    expect(r).toMatchObject({ reclaimed: [jobId], requeued: [], parked: [jobId], followup: null });
    const cards = pendingInfo(db, U);
    expect(cards.map((c) => c.jobId)).toEqual([jobId]);
    expect(cards[0].questions[0]).toMatchObject({ key: "error", kind: "manual" });
    expect(db.prepare("SELECT COUNT(*) n FROM executor_runs WHERE status = 'queued'").get()).toEqual({ n: 0 });
  });
});
