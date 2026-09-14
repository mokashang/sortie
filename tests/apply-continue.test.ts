import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { parseProfile, Profile } from "@/lib/profile";
import { takeNextApplication, reportFill, decide } from "@/apply/queue";
import { takeNextReferral, reportNoContact } from "@/apply/referral";
import { startExecutor, claimNextRun, finishRun, stopExecutor, StartOptions } from "@/executor/runner";
import {
  maybeContinueApplyRun,
  resumePausedChainIfReady,
  supersedePausedChain,
  remainingPlan,
  unconfirmedCount,
  BACKLOG_PAUSE_AT,
} from "@/apply/continue";
import { decideAndMaybeAutoStart } from "@/apply/decide-auto-start";
import { runProgressText, runStatusDisplay } from "@/app/lib/run-outcome";

// 接力(2026-09-13):计划 70 份,一个会话只做一段(chunk),收工时 App 自动排下一段做剩下的;未确认的
// 申请积压到 10 份就先挂起(paused),确认到 5 份以下自动继续;用户点停止 / 开新计划就断链。

const baseYaml = `
name: Mengjia Shang
email: shangmengjiajiajia@gmail.com
phone: "+1-323-244-7662"
linkedin: linkedin.com/in/mengjia-shang
github: github.com/mokashang
school: University of Southern California
degree: M.S. ECE
grad_date: "2027-05"
work_auth:
  status: F-1
  needs_sponsorship: true
targets:
  primary: newgrad
  secondary: intern
directions:
  swe_general: 1
  swe_backend: 1
daily_minutes_budget: 90
`;
const profile: Profile = parseProfile(baseYaml);

let seq = 0;
function seedJob(db: DB, opts: { company?: string; direction?: string; score?: number; applyMode?: string } = {}): number {
  seq += 1;
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(`fp-${seq}`, opts.company ?? `Co${seq}`, "SWE New Grad", `https://co${seq}.example/apply`, "greenhouse", "manual", "2026-01-01 00:00:00")
    .lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, opts.direction ?? "swe_general", opts.score ?? 80, 1);
  db.prepare("INSERT INTO applications (job_id, status, apply_mode) VALUES (?,?,?)").run(jobId, "matched", opts.applyMode ?? null);
  return jobId;
}

function seedResumes(db: DB): void {
  for (const dir of ["swe_general", "swe_backend"]) {
    db.prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)").run(
      `${dir}_v1`,
      JSON.stringify([dir]),
      `/data/r/${dir}_v1.pdf`,
      "2026-01-01 00:00:00"
    );
  }
}

interface RunRow {
  status: string;
  channel: string;
  options: string;
  summary: string | null;
  log_path: string | null;
  outcome: string | null;
}
function runRow(db: DB, id: number): RunRow {
  return db.prepare("SELECT status, channel, options, summary, log_path, outcome FROM executor_runs WHERE id = ?").get(id) as RunRow;
}
function optionsOf(db: DB, id: number): StartOptions {
  return JSON.parse(runRow(db, id).options);
}

describe("接力 maybeContinueApplyRun / resumePausedChainIfReady", () => {
  let db: DB;
  let logDir: string;

  beforeEach(() => {
    db = openDb(":memory:");
    seedResumes(db);
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-continue-"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  // A segment as the attended session sees it: queued by the App, claimed, driven, finished.
  function startSegment(options: StartOptions): number {
    const { id } = startExecutor(db, "apply", options, { logDir }, "user_chrome");
    expect(claimNextRun(db, "user_chrome")?.id).toBe(id);
    return id;
  }
  function fillNext(direction = "swe_general"): number {
    const task = takeNextApplication(db, profile, { direction }) as { jobId: number };
    expect(task.jobId).toBeTypeOf("number");
    reportFill(db, { jobId: task.jobId, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });
    return task.jobId;
  }

  it("queues the next segment with the remaining plan, chain bookkeeping and resume:true; the last segment reports cumulative progress", () => {
    for (let i = 0; i < 4; i++) seedJob(db, { score: 95 - i });
    const a = startSegment({ plan: [{ direction: "swe_general", count: 4, mode: "direct" }], chunk: 2 });
    fillNext();
    fillNext();
    finishRun(db, a, "done", "segment 1");

    const r = maybeContinueApplyRun(db, a, { logDir });
    expect(r).toMatchObject({ action: "queued", channel: "user_chrome" });
    const b = (r as { runId: number }).runId;
    expect(runRow(db, b).status).toBe("queued");
    expect(optionsOf(db, b)).toEqual({
      resume: true,
      plan: [{ direction: "swe_general", count: 2, mode: "direct" }],
      chunk: 2,
      chain: { root: a, step: 2, planned: { direct: 4, referral: 0 }, before: { direct: 2, referral: 0 }, zeroRuns: 0 },
    });
    // Segment 1's own outcome: planned is the whole plan, achieved its own share, 未完成.
    const first = JSON.parse(runRow(db, a).outcome!);
    expect(first).toMatchObject({ planned: { direct: 4, referral: 0 }, achieved: { direct: 2, referral: 0 }, complete: false });
    expect(first.chain).toBeUndefined();
    expect(runStatusDisplay("done", first).label).toBe("未完成");

    // Segment 2 finishes the plan: cumulative outcome, 已完成, no third segment.
    expect(claimNextRun(db, "user_chrome")?.id).toBe(b);
    fillNext();
    fillNext();
    finishRun(db, b, "done", "segment 2");
    const second = JSON.parse(runRow(db, b).outcome!);
    expect(second).toMatchObject({
      planned: { direct: 4, referral: 0 },
      achieved: { direct: 4, referral: 0 },
      own: { direct: 2, referral: 0 },
      awaiting: 2,
      complete: true,
      chain: { root: a, step: 2 },
    });
    expect(runProgressText(second)).toBe("海投 4/4 · 本段 2");
    expect(runStatusDisplay("done", second).label).toBe("已完成");
    expect(maybeContinueApplyRun(db, b, { logDir })).toMatchObject({ action: "none", reason: expect.stringContaining("finished") });
  });

  it("drops an entry the segment attempted without progress (quota, exhausted) and keeps entries it never reached", () => {
    seedJob(db, { company: "Tradeweb", applyMode: "referral", score: 90 });
    seedJob(db, { score: 80 });
    seedJob(db, { score: 79 });
    seedJob(db, { direction: "swe_backend", score: 85 });
    const plan = [
      { direction: "swe_general", count: 2, mode: "referral" as const },
      { direction: "swe_general", count: 3, mode: "direct" as const },
      { direction: "swe_backend", count: 3, mode: "direct" as const },
    ];
    const a = startSegment({ plan, chunk: 10 });
    const task = takeNextReferral(db, { direction: "swe_general" }) as { company: string; jobs: { jobId: number }[] };
    expect(task.company).toBe("Tradeweb");
    reportNoContact(db, task.jobs.map((j) => j.jobId), "LinkedIn free invite quota exhausted");
    fillNext();

    const { remaining, dropped, own } = remainingPlan(db, a, plan);
    expect(own).toEqual({ direct: 1, referral: 0 });
    expect(dropped).toEqual([{ direction: "swe_general", count: 2, mode: "referral" }]);
    expect(remaining).toEqual([
      { direction: "swe_general", count: 2, mode: "direct" },
      { direction: "swe_backend", count: 3, mode: "direct" },
    ]);

    finishRun(db, a, "done");
    const r = maybeContinueApplyRun(db, a, { logDir }) as { action: string; runId: number };
    expect(r.action).toBe("queued");
    expect(optionsOf(db, r.runId).plan).toEqual(remaining);
    expect(optionsOf(db, r.runId).chain).toMatchObject({ root: a, step: 2, planned: { direct: 6, referral: 2 }, before: { direct: 1, referral: 0 } });
  });

  it("parks the next segment as paused behind the confirmation backlog and resumes it in place once the user decides enough", () => {
    for (let i = 0; i < 12; i++) seedJob(db, { score: 95 - i });
    const a = startSegment({ plan: [{ direction: "swe_general", count: 12, mode: "direct" }], chunk: BACKLOG_PAUSE_AT });
    const filled: number[] = [];
    for (let i = 0; i < BACKLOG_PAUSE_AT; i++) filled.push(fillNext());
    finishRun(db, a, "done");
    expect(unconfirmedCount(db)).toBe(10);

    const r = maybeContinueApplyRun(db, a, { logDir });
    expect(r).toMatchObject({ action: "paused", unconfirmed: 10 });
    const p = (r as { runId: number }).runId;
    expect(runRow(db, p)).toMatchObject({ status: "paused", channel: "user_chrome" });
    expect(runRow(db, p).summary).toContain("等待确认");
    expect(optionsOf(db, p)).toMatchObject({
      resume: true,
      plan: [{ direction: "swe_general", count: 2, mode: "direct" }],
      chain: { root: a, step: 2, before: { direct: 10, referral: 0 } },
    });
    expect(resumePausedChainIfReady(db, { logDir })).toMatchObject({ action: "none", reason: expect.stringContaining("backlog") });

    // Four decisions bring the backlog to 6: still parked. Approve and reject both count.
    decide(db, filled[0], "approve");
    decide(db, filled[1], "reject", "wrong resume");
    decide(db, filled[2], "approve");
    decide(db, filled[3], "approve");
    expect(unconfirmedCount(db)).toBe(6);
    expect(resumePausedChainIfReady(db, { logDir })).toMatchObject({ action: "none" });
    expect(runRow(db, p).status).toBe("paused");

    // The fifth decision, through the App's decide path, resumes the chain: same row, now queued,
    // with a log file ready for the attended session.
    const result = decideAndMaybeAutoStart(db, filled[4], "reject", "not interested", { logDir });
    expect(result).toEqual({ autoStarted: true, runId: p, channel: "user_chrome" });
    const row = runRow(db, p);
    expect(row.status).toBe("queued");
    expect(row.summary).toBeNull();
    expect(row.log_path).not.toBeNull();
    expect(fs.existsSync(row.log_path!)).toBe(true);
    expect(claimNextRun(db, "user_chrome")?.id).toBe(p);
  });

  it("gives a zero-progress segment one more try (the entry may never have been reached), then stops the chain", () => {
    const a = startSegment({ plan: [{ direction: "swe_general", count: 5, mode: "direct" }], chunk: 10 });
    expect(takeNextApplication(db, profile, { direction: "swe_general" })).toEqual({ done: true });
    finishRun(db, a, "done", "queue empty");
    const r = maybeContinueApplyRun(db, a, { logDir }) as { action: string; runId: number };
    expect(r.action).toBe("queued");
    expect(optionsOf(db, r.runId).chain).toMatchObject({ step: 2, zeroRuns: 1 });

    expect(claimNextRun(db, "user_chrome")?.id).toBe(r.runId);
    finishRun(db, r.runId, "done", "still empty");
    expect(maybeContinueApplyRun(db, r.runId, { logDir })).toMatchObject({ action: "none", reason: expect.stringContaining("no progress") });
  });

  it("never continues a stopped or failed run, or a run without a plan", () => {
    seedJob(db, { score: 95 });
    seedJob(db, { score: 90 });
    const a = startSegment({ plan: [{ direction: "swe_general", count: 2, mode: "direct" }], chunk: 1 });
    fillNext();
    stopExecutor(db, a);
    expect(maybeContinueApplyRun(db, a, { logDir })).toMatchObject({ action: "none", reason: expect.stringContaining("stopped") });

    const b = startSegment({ plan: [{ direction: "swe_general", count: 1, mode: "direct" }], chunk: 1 });
    finishRun(db, b, "failed", "extension disconnected");
    expect(maybeContinueApplyRun(db, b, { logDir })).toMatchObject({ action: "none" });

    const c = startSegment({ resume: true });
    finishRun(db, c, "done");
    expect(maybeContinueApplyRun(db, c, { logDir })).toMatchObject({ action: "none", reason: "no plan to continue" });
  });

  it("a paused chain can be stopped by the user, and a new plan from /apply supersedes one", () => {
    for (let i = 0; i < 11; i++) seedJob(db, { score: 95 - i });
    const a = startSegment({ plan: [{ direction: "swe_general", count: 11, mode: "direct" }], chunk: 10 });
    for (let i = 0; i < 10; i++) fillNext();
    finishRun(db, a, "done");
    const p = (maybeContinueApplyRun(db, a, { logDir }) as { runId: number }).runId;
    expect(runRow(db, p).status).toBe("paused");
    stopExecutor(db, p);
    expect(runRow(db, p).status).toBe("stopped");
    // Its outcome still reads the chain's progress under the 已停止 label.
    const outcome = JSON.parse(runRow(db, p).outcome!);
    expect(outcome).toMatchObject({ planned: { direct: 11, referral: 0 }, achieved: { direct: 10, referral: 0 }, own: { direct: 0, referral: 0 } });
    expect(runStatusDisplay("stopped", outcome).label).toBe("已停止");
    expect(resumePausedChainIfReady(db, { logDir })).toMatchObject({ action: "none", reason: "no paused chain" });

    // Another chain parks itself (backlog still 10); the user starting a new plan supersedes it.
    const b = startSegment({ plan: [{ direction: "swe_general", count: 5, mode: "direct" }], chunk: 10 });
    fillNext();
    finishRun(db, b, "done");
    const p2 = (maybeContinueApplyRun(db, b, { logDir }) as { runId: number; action: string });
    expect(p2.action).toBe("paused");
    expect(supersedePausedChain(db)).toBe(1);
    expect(runRow(db, p2.runId)).toMatchObject({ status: "stopped", summary: "被新的投递计划取代" });
  });
});
