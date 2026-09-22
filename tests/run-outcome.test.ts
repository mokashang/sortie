import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { parseProfile, Profile } from "@/lib/profile";
import { takeNextApplication, reportFill, decide, reportSubmitted } from "@/apply/queue";
import { takeNextReferral, reportNoContact } from "@/apply/referral";
import { startExecutor, claimNextRun, finishRun, stopExecutor, executorStatus } from "@/executor/runner";
import { computeRunOutcome, plannedCounts, currentApplyRunId } from "@/apply/run-outcome";
import { runStatusDisplay, runProgressText } from "@/app/lib/run-outcome";

// 任务 #68(2026-09-13):计划海投 70,填了 5 份就收工,任务却显示「已完成」。这里锁定的行为:取件时把
// run id 盖到 applications.run_id 上;run 到终态时按 run_id 算出 计划数/实际数 写进 executor_runs.outcome;
// 界面据此把没达标的 done 显示为「未完成 · 海投 5/70」。

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
daily_minutes_budget: 90
`;

function testProfile(): Profile {
  return parseProfile(baseYaml);
}

const U = "legacy";
function openTestDb(): DB {
  const db = openDb(":memory:");
  seedOwner(db, U);
  return db;
}

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

function seedResume(db: DB): void {
  db.prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)").run(
    "swe_general_v1",
    JSON.stringify(["swe_general"]),
    "/data/r/swe_general_v1.pdf",
    "2026-01-01 00:00:00"
  );
}

function runIdOf(db: DB, jobId: number): number | null {
  return (db.prepare("SELECT run_id FROM applications WHERE job_id = ?").get(jobId) as { run_id: number | null }).run_id;
}

function storedOutcome(db: DB, runId: number) {
  const raw = (db.prepare("SELECT outcome FROM executor_runs WHERE id = ?").get(runId) as { outcome: string | null }).outcome;
  return raw ? JSON.parse(raw) : null;
}

describe("plannedCounts", () => {
  it("sums a plan by mode, sizes a targeted jobIds run, and is null when there is nothing to measure against", () => {
    expect(
      plannedCounts({
        plan: [
          { direction: "swe_general", count: 20, mode: "referral" },
          { direction: "swe_general", count: 40, mode: "direct" },
          { direction: "swe_backend", count: 30 },
        ],
      })
    ).toEqual({ direct: 70, referral: 20 });
    expect(plannedCounts({ jobIds: [1, 2, 3], mode: "direct" })).toEqual({ direct: 3, referral: 0 });
    expect(plannedCounts({ jobIds: [1, 2], mode: "referral" })).toEqual({ direct: 0, referral: 2 });
    expect(plannedCounts({ resume: true })).toBeNull();
    expect(plannedCounts({})).toBeNull();
    expect(plannedCounts("garbage")).toBeNull();
  });
});

describe("run outcome end to end", () => {
  let db: DB;
  let logDir: string;

  beforeEach(() => {
    db = openTestDb();
    seedResume(db);
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "run-outcome-"));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  function startPlanRun(plan: { direction: string; count: number; mode: "direct" | "referral" }[]): number {
    const { id } = startExecutor(db, U, "apply", { plan }, { logDir }, "user_chrome");
    expect(claimNextRun(db, U, "user_chrome")?.id).toBe(id);
    return id;
  }

  it("stamps run_id on claimed jobs and settles 未完成 with the counts when the plan is not met", () => {
    const a = seedJob(db, { score: 95 });
    const b = seedJob(db, { score: 90 });
    const c = seedJob(db, { score: 85 });
    seedJob(db, { score: 80 }); // never taken — the run stops short
    const runId = startPlanRun([{ direction: "swe_general", count: 4, mode: "direct" }]);
    expect(currentApplyRunId(db, U)).toBe(runId);

    // a: filled, confirmed, submitted.
    expect((takeNextApplication(db, U, testProfile(), { direction: "swe_general" }) as { jobId: number }).jobId).toBe(a);
    expect(runIdOf(db, a)).toBe(runId);
    reportFill(db, U, { jobId: a, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });
    decide(db, U, a, "approve");
    reportSubmitted(db, U, a);
    // b: dead link → closed (archived without a card).
    expect((takeNextApplication(db, U, testProfile(), { direction: "swe_general" }) as { jobId: number }).jobId).toBe(b);
    reportFill(db, U, { jobId: b, status: "closed", reason: "dead link" });
    // c: filled, still waiting for the user when the run ends.
    expect((takeNextApplication(db, U, testProfile(), { direction: "swe_general" }) as { jobId: number }).jobId).toBe(c);
    reportFill(db, U, { jobId: c, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });

    expect(storedOutcome(db, runId)).toBeNull(); // nothing settled while the run is live
    finishRun(db, U, runId, "done", "submitted 1, filled 1 more");

    const outcome = storedOutcome(db, runId);
    expect(outcome).toEqual({
      planned: { direct: 4, referral: 0 },
      achieved: { direct: 2, referral: 0 },
      own: { direct: 2, referral: 0 },
      submitted: 1,
      awaiting: 1,
      manual: 0,
      archived: 1,
      info: 0,
      complete: false,
    });
    expect(computeRunOutcome(db, runId)).toEqual(outcome);
    expect(runStatusDisplay("done", outcome, "zh")).toEqual({ label: "未完成", tone: "warn" });
    expect(runProgressText(outcome, "zh")).toBe("海投 2/4");

    // The status endpoint carries the parsed outcome to the UI.
    const row = executorStatus(db, U).find((r) => r.id === runId)!;
    expect(row.outcome).toEqual(outcome);
    expect(currentApplyRunId(db, U)).toBeNull();
  });

  it("is 已完成 when every planned application was filled, even if some are still awaiting confirmation", () => {
    const a = seedJob(db, { score: 95 });
    const b = seedJob(db, { score: 90 });
    const runId = startPlanRun([{ direction: "swe_general", count: 2, mode: "direct" }]);
    for (const id of [a, b]) {
      expect((takeNextApplication(db, U, testProfile(), { direction: "swe_general" }) as { jobId: number }).jobId).toBe(id);
      reportFill(db, U, { jobId: id, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });
    }
    finishRun(db, U, runId, "done");
    const outcome = storedOutcome(db, runId);
    expect(outcome).toMatchObject({ achieved: { direct: 2, referral: 0 }, awaiting: 2, complete: true });
    expect(runStatusDisplay("done", outcome, "zh")).toEqual({ label: "已完成", tone: "good" });
  });

  it("a user-rejected fill still counts as filled (the fill happened) but shows as a 待处理 card", () => {
    const a = seedJob(db, { score: 95 });
    const runId = startPlanRun([{ direction: "swe_general", count: 1, mode: "direct" }]);
    takeNextApplication(db, U, testProfile(), { direction: "swe_general" });
    reportFill(db, U, { jobId: a, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });
    decide(db, U, a, "reject", "wrong resume");
    finishRun(db, U, runId, "done");
    expect(storedOutcome(db, runId)).toMatchObject({ achieved: { direct: 1, referral: 0 }, info: 1, manual: 0, complete: true });
  });

  it("a login wall or an executor error is a 待处理 card, never an achievement", () => {
    const a = seedJob(db, { score: 95 });
    const b = seedJob(db, { score: 90 });
    const runId = startPlanRun([{ direction: "swe_general", count: 2, mode: "direct" }]);
    takeNextApplication(db, U, testProfile(), { direction: "swe_general" });
    reportFill(db, U, { jobId: a, status: "needs_info", questions: [{ kind: "login", key: "x", label: "登录一次", host: "a.example" }] });
    takeNextApplication(db, U, testProfile(), { direction: "swe_general" });
    reportFill(db, U, { jobId: b, status: "error", reason: "tab crashed" });
    finishRun(db, U, runId, "done");
    expect(storedOutcome(db, runId)).toMatchObject({ achieved: { direct: 0, referral: 0 }, info: 2, manual: 0, complete: false });
  });

  it("referral entries: a company with someone to contact counts, a 找不到人 company does not", () => {
    const e = seedJob(db, { company: "Tradeweb", score: 90, applyMode: "referral" });
    const f = seedJob(db, { company: "Scale AI", score: 88, applyMode: "referral" });
    const runId = startPlanRun([{ direction: "swe_general", count: 2, mode: "referral" }]);

    const first = takeNextReferral(db, U, { direction: "swe_general" }) as { company: string; jobs: { jobId: number }[] };
    expect(first.company).toBe("Tradeweb");
    expect(runIdOf(db, e)).toBe(runId);
    reportNoContact(db, U, [e], "LinkedIn free invite quota exhausted");
    const second = takeNextReferral(db, U, { direction: "swe_general" }) as { company: string };
    expect(second.company).toBe("Scale AI");
    expect(runIdOf(db, f)).toBe(runId);

    finishRun(db, U, runId, "done");
    const outcome = storedOutcome(db, runId);
    expect(outcome).toMatchObject({ planned: { direct: 0, referral: 2 }, achieved: { direct: 0, referral: 1 }, manual: 1, complete: false });
    expect(runProgressText(outcome, "zh")).toBe("内推 1/2");
  });

  it("a run stopped by the user gets its outcome too, under its own label", () => {
    const a = seedJob(db, { score: 95 });
    seedJob(db, { score: 90 });
    const runId = startPlanRun([{ direction: "swe_general", count: 2, mode: "direct" }]);
    takeNextApplication(db, U, testProfile(), { direction: "swe_general" });
    reportFill(db, U, { jobId: a, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });
    stopExecutor(db, U, runId);
    const outcome = storedOutcome(db, runId);
    expect(outcome).toMatchObject({ achieved: { direct: 1, referral: 0 }, complete: false });
    expect(runStatusDisplay("stopped", outcome, "zh")).toEqual({ label: "已停止", tone: "neutral" });
    expect(runProgressText(outcome, "zh")).toBe("海投 1/2");
  });

  it("runs with no plan (resume-only, other kinds) get no outcome and keep the plain 已完成", () => {
    const { id } = startExecutor(db, U, "apply", { resume: true }, { logDir }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    finishRun(db, U, id, "done");
    expect(storedOutcome(db, id)).toBeNull();
    expect(runStatusDisplay("done", null, "zh")).toEqual({ label: "已完成", tone: "good" });

    const check = startExecutor(db, U, "referral_check", {}, { logDir }, "user_chrome");
    claimNextRun(db, U, "user_chrome");
    finishRun(db, U, check.id, "done");
    expect(storedOutcome(db, check.id)).toBeNull();
  });

  it("a job claimed with no apply run live is not stamped, and a later run only counts its own rows", () => {
    const a = seedJob(db, { score: 95 });
    const b = seedJob(db, { score: 90 });
    takeNextApplication(db, U, testProfile(), { direction: "swe_general" });
    expect(runIdOf(db, a)).toBeNull();
    reportFill(db, U, { jobId: a, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });

    const runId = startPlanRun([{ direction: "swe_general", count: 1, mode: "direct" }]);
    expect((takeNextApplication(db, U, testProfile(), { direction: "swe_general" }) as { jobId: number }).jobId).toBe(b);
    reportFill(db, U, { jobId: b, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });
    finishRun(db, U, runId, "done");
    expect(storedOutcome(db, runId)).toMatchObject({ achieved: { direct: 1, referral: 0 }, awaiting: 1, complete: true });
  });
});

describe("v14 → v15 migration", () => {
  let tmpFile: string | null = null;
  afterEach(() => {
    if (tmpFile) {
      fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
      tmpFile = null;
    }
  });

  it("adds applications.run_id and executor_runs.outcome to a v14-shaped db, and is re-runnable", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobseeker-v15-"));
    tmpFile = path.join(tmpDir, "v14.db");
    const raw = new Database(tmpFile);
    raw.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fingerprint TEXT NOT NULL UNIQUE,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        jd_text TEXT,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
        status TEXT NOT NULL DEFAULT 'discovered',
        submitted_at TEXT,
        resume_id INTEGER,
        form_screenshot TEXT,
        confirm_screenshot TEXT,
        referral_person_id INTEGER,
        origin_outreach_id INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE executor_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        channel TEXT NOT NULL DEFAULT 'headless',
        pid INTEGER,
        log_path TEXT,
        options TEXT NOT NULL DEFAULT '{}',
        summary TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        claimed_at TEXT,
        ended_at TEXT
      );
    `);
    raw.pragma("user_version = 14");
    raw.prepare("INSERT INTO executor_runs (kind, status, options) VALUES (?,?,?)").run("apply", "done", '{"plan":[{"direction":"swe_general","count":70,"mode":"direct"}]}');
    raw.close();

    const db = openDb(tmpFile);
    const appCols = (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map((c) => c.name);
    const runCols = (db.prepare("PRAGMA table_info(executor_runs)").all() as { name: string }[]).map((c) => c.name);
    expect(appCols).toContain("run_id");
    expect(runCols).toContain("outcome");
    expect(db.pragma("user_version", { simple: true })).toBe(18);
    // Pre-existing runs keep a null outcome (nothing was stamped for them) → still the plain 已完成.
    expect((db.prepare("SELECT outcome FROM executor_runs WHERE id = 1").get() as { outcome: string | null }).outcome).toBeNull();
    db.close();

    const again = openDb(tmpFile);
    expect(again.pragma("user_version", { simple: true })).toBe(18);
    again.close();
  });
});
