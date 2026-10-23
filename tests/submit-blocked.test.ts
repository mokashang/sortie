import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { parseProfile } from "@/lib/profile";
import { takeNextApplication, reportFill, decide, reportSubmitted, SUBMIT_BLOCKED_PREFIX } from "@/apply/queue";
import { pendingInfo } from "@/apply/info";
import { recordExternalSubmission } from "@/apply/history";
import { startExecutor, claimNextRun, finishRun } from "@/executor/runner";
import { computeRunOutcome } from "@/apply/run-outcome";
import { unconfirmedCount } from "@/apply/continue";
import { retryBlockedSubmit, notifySubmitBlocked, submitBlockedCount, resetSubmitPushThrottle, SUBMIT_PUSH_EVERY_MS } from "@/apply/submit-blocked";

// 2026-10-22: the spawned sessions' own permission check refused every final Submit click (task
// #606: ten forms filled and auto-approved, none sent; 33 approvals stuck at one point). The user:
// the session reports it and moves on, the App makes a card — click Submit in the tab, then 「我提交了」;
// or have the assistant try again; or skip — and pushes a notification.

const U = "legacy";
const profile = parseProfile(`
name: Mengjia Shang
email: mengjia@example.com
phone: "+1-323-244-7662"
linkedin: linkedin.com/in/x
github: github.com/x
school: University of Southern California
degree: M.S. ECE
grad_date: "2027-05"
work_auth: { status: F-1, needs_sponsorship: true }
targets: { primary: newgrad }
directions: { swe_general: 1 }
`);

let seq = 0;
function seedJob(db: DB, company = `Co${++seq}`): number {
  const id = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(`fp-sb-${seq}-${company}`, company, "SWE New Grad", `https://${company.toLowerCase()}.example/apply`, "greenhouse", "manual", "2026-01-01 00:00:00")
    .lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(id, "swe_general", 90, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'matched')").run(id);
  return id;
}

function row(db: DB, jobId: number) {
  return db.prepare("SELECT status, confirm_decision, needs_manual_reason, pending_questions FROM applications WHERE job_id = ?").get(jobId) as {
    status: string;
    confirm_decision: string | null;
    needs_manual_reason: string | null;
    pending_questions: string | null;
  };
}

describe("a refused Submit click becomes a 「点提交」 card", () => {
  let db: DB;
  let logDir: string;
  beforeEach(() => {
    db = openDb(":memory:");
    seedOwner(db, U);
    db.prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)").run("swe_general_v1", JSON.stringify(["swe_general"]), "/r.pdf", "2026-01-01 00:00:00");
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "submit-blocked-"));
    resetSubmitPushThrottle();
  });
  afterEach(() => {
    db.close();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  // What a segment does with a job: take it, fill it, have it approved (auto-apply or the user).
  function filledAndApproved(company?: string): { jobId: number; runId: number } {
    const jobId = seedJob(db, company);
    const run = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 10, mode: "direct" }], chunk: 10 }, { logDir, queueBehind: true }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    const task = takeNextApplication(db, U, profile, { jobIds: [jobId] }) as { jobId: number };
    expect(task.jobId).toBe(jobId);
    reportFill(db, U, { jobId, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });
    decide(db, U, jobId, "approve");
    return { jobId, runId: run.id };
  }

  it("parks the approved fill with a submit item, keeps the approval, and shows it on 待处理", () => {
    const { jobId } = filledAndApproved("Perpay");
    reportFill(db, U, { jobId, status: "submit_blocked", reason: "permission classifier refused the Submit click (Real-World Transactions)" });
    const r = row(db, jobId);
    expect(r).toMatchObject({ status: "matched", confirm_decision: "approved" });
    expect(r.needs_manual_reason).toMatch(new RegExp(`^${SUBMIT_BLOCKED_PREFIX}permission classifier`));
    expect(JSON.parse(r.pending_questions!)).toEqual([
      expect.objectContaining({ key: "submit", kind: "submit", hint: expect.stringContaining("Real-World"), url: "https://perpay.example/apply" }),
    ]);
    const card = pendingInfo(db, U, "zh").find((c) => c.jobId === jobId);
    expect(card?.questions.map((q) => q.kind)).toEqual(["submit"]);
    expect(submitBlockedCount(db, U)).toBe(1);
    // Not something the queue hands out again, and not a stranded approval for a resume run.
    expect(takeNextApplication(db, U, profile, { direction: "swe_general" })).toEqual({ done: true });
    expect(db.prepare("SELECT COUNT(*) n FROM applications WHERE status = 'awaiting_confirm' AND confirm_decision = 'approved'").get()).toEqual({ n: 0 });
  });

  it("only an approved fill can have its Submit refused", () => {
    const jobId = seedJob(db);
    startExecutor(db, U, "apply", { jobIds: [jobId], mode: "direct" }, { logDir, queueBehind: true }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    takeNextApplication(db, U, profile, { jobIds: [jobId] });
    reportFill(db, U, { jobId, status: "awaiting_confirm", filledFields: { Name: "x" } });
    expect(() => reportFill(db, U, { jobId, status: "submit_blocked", reason: "x" })).toThrow(/not approved/);
  });

  it("counts as filled for the plan and as backlog for the relay", () => {
    const { jobId, runId } = filledAndApproved();
    reportFill(db, U, { jobId, status: "submit_blocked", reason: "refused" });
    finishRun(db, U, runId, "done");
    expect(computeRunOutcome(db, runId)).toMatchObject({ own: { direct: 1, referral: 0 } });
    expect(unconfirmedCount(db, U)).toBe(1);
  });

  it("「我提交了」 records the submission", () => {
    const { jobId } = filledAndApproved();
    reportFill(db, U, { jobId, status: "submit_blocked", reason: "refused" });
    recordExternalSubmission(db, U, jobId, "user clicked Submit");
    expect(row(db, jobId)).toMatchObject({ status: "submitted", needs_manual_reason: null, pending_questions: null });
    expect(submitBlockedCount(db, U)).toBe(0);
  });

  it("「让助手再试一次」 hands the approved form back to the session that holds the tab", () => {
    const { jobId } = filledAndApproved("Quora");
    reportFill(db, U, { jobId, status: "submit_blocked", reason: "refused" });
    const lines: string[] = [];
    const r = retryBlockedSubmit(db, U, jobId, "I re-ticked the captcha", { notifySession: (line) => (lines.push(line), true), logDir });
    expect(r).toEqual({ notified: true });
    expect(lines[0]).toMatch(new RegExp(`approved job ${jobId} \\(Quora\\)`));
    expect(lines[0]).toMatch(/submit_blocked/);
    expect(row(db, jobId)).toMatchObject({ status: "awaiting_confirm", confirm_decision: "approved", needs_manual_reason: null, pending_questions: null });
    // The session clicks Submit this time: the red line lets it through.
    reportSubmitted(db, U, jobId);
    expect(row(db, jobId).status).toBe("submitted");
  });

  it("with nobody holding the tab, 「让助手再试一次」 fills the job afresh — and the fresh fill needs its own approval", () => {
    const { jobId, runId } = filledAndApproved();
    reportFill(db, U, { jobId, status: "submit_blocked", reason: "refused" });
    finishRun(db, U, runId, "done");
    const r = retryBlockedSubmit(db, U, jobId, undefined, { notifySession: () => false, logDir });
    expect(r).toMatchObject({ notified: false, autoStarted: true });
    expect(row(db, jobId)).toMatchObject({ status: "matched", confirm_decision: null, needs_manual_reason: null, pending_questions: null });
    const queued = db.prepare("SELECT options FROM executor_runs WHERE id = ?").get((r as { runId: number }).runId) as { options: string };
    expect(JSON.parse(queued.options)).toMatchObject({ jobIds: [jobId], mode: "direct" });
    expect(() => retryBlockedSubmit(db, U, jobId, undefined, { notifySession: () => false, logDir })).toThrow(/not waiting on a Submit click/);
  });

  it("pushes at most once per half hour per account, then says how many are waiting", () => {
    const pushes: string[] = [];
    const push = (title: string) => void pushes.push(title);
    const a = filledAndApproved("Brain");
    reportFill(db, U, { jobId: a.jobId, status: "submit_blocked", reason: "refused" });
    const t0 = Date.parse("2026-10-22T18:00:00Z");
    expect(notifySubmitBlocked(db, U, a.jobId, "zh", { now: t0, push })).toBe(true);
    expect(pushes[0]).toContain("Brain");

    const b = filledAndApproved("Funnel");
    reportFill(db, U, { jobId: b.jobId, status: "submit_blocked", reason: "refused" });
    expect(notifySubmitBlocked(db, U, b.jobId, "zh", { now: t0 + 60_000, push })).toBe(false);
    expect(notifySubmitBlocked(db, U, b.jobId, "en", { now: t0 + SUBMIT_PUSH_EVERY_MS + 1, push })).toBe(true);
    expect(pushes[1]).toMatch(/2 applications/);
  });
});
