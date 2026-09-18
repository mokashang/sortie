import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { parseProfile, saveProfile, getProfileData } from "@/lib/profile";
import { createExperience } from "@/resume/experiences";
import { reportFill, reportSubmitted, confirmStatus } from "@/apply/queue";
import { getAutoSubmit, setAutoSubmit, autoApproveIfEnabled } from "@/apply/auto-submit";
import { autoAnswerPending, buildAutoAnswerPrompt, parseAutoAnswers } from "@/apply/auto-answer";
import type { LlmBackend, LlmRequest } from "@/llm/types";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

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
  ai_infra: 1
daily_minutes_budget: 90
standard_answers:
  city: Los Angeles
`;

function seedProfile(db: DB): void {
  saveProfile(db, U, parseProfile(baseYaml));
  createExperience(db, U, {
    kind: "project",
    title: "CUDA kernel tuner",
    organization: null,
    bullets: [{ text: "Wrote CUDA kernels and a Python harness; 3x speedup over cuBLAS baseline", directions: ["ai_infra"] }],
    sort_order: 0,
  });
}

function seedJob(db: DB, status = "prepared"): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, created_at, jd_text) VALUES (?,?,?,?,?,?,?,?)")
    .run(`fp-${Math.random()}`, "Acme", "SWE", "https://acme.example/apply", "greenhouse", "manual", "2026-01-01 00:00:00", "Build things in Python.")
    .lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "ai_infra", 80, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(jobId, status);
  return jobId;
}

function fakeBackend(reply: string | ((req: LlmRequest) => string)): LlmBackend & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    name: "fake",
    calls,
    async complete(req: LlmRequest) {
      calls.push(req);
      return { text: typeof reply === "function" ? reply(req) : reply, backend: "fake" };
    },
  };
}

describe("自动投递 switch", () => {
  it("is off by default, per account, and round-trips", () => {
    const db = openDb(":memory:");
    expect(getAutoSubmit(db, U)).toBe(false);
    setAutoSubmit(db, U, true);
    expect(getAutoSubmit(db, U)).toBe(true);
    expect(getAutoSubmit(db, "someone-else")).toBe(false);
    setAutoSubmit(db, U, false);
    expect(getAutoSubmit(db, U)).toBe(false);
  });

  it("off: an awaiting_confirm report stays unapproved and reportSubmitted still refuses", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db);
    reportFill(db, U, { jobId, status: "awaiting_confirm", filledFields: { Name: "Mengjia" } });
    expect(autoApproveIfEnabled(db, U, jobId)).toBe(false);
    expect(confirmStatus(db, U, jobId).decision).toBeNull();
    expect(() => reportSubmitted(db, U, jobId)).toThrow(/red line/);
  });

  it("on: the App grants the approval the moment the fill is reported, so the red line lets the submit through", () => {
    const db = openDb(":memory:");
    setAutoSubmit(db, U, true);
    const jobId = seedJob(db);
    reportFill(db, U, { jobId, status: "awaiting_confirm", filledFields: { Name: "Mengjia" } });
    expect(autoApproveIfEnabled(db, U, jobId)).toBe(true);
    expect(confirmStatus(db, U, jobId).decision).toBe("approved");
    reportSubmitted(db, U, jobId);
    expect((db.prepare("SELECT status FROM applications WHERE job_id = ?").get(jobId) as { status: string }).status).toBe("submitted");
  });

  it("a re-report still voids the earlier approval; it is only re-granted while the switch is on", () => {
    const db = openDb(":memory:");
    setAutoSubmit(db, U, true);
    const jobId = seedJob(db);
    reportFill(db, U, { jobId, status: "awaiting_confirm", filledFields: { Name: "Mengjia" } });
    autoApproveIfEnabled(db, U, jobId);
    setAutoSubmit(db, U, false);
    reportFill(db, U, { jobId, status: "awaiting_confirm", filledFields: { Name: "Mengjia S." } });
    expect(confirmStatus(db, U, jobId).decision).toBeNull();
    expect(autoApproveIfEnabled(db, U, jobId)).toBe(false);
    expect(() => reportSubmitted(db, U, jobId)).toThrow(/red line/);
  });
});

describe("auto-answer", () => {
  it("prompt carries the candidate facts, the experience bank, the job and the questions", () => {
    const db = openDb(":memory:");
    seedProfile(db);
    const profile = parseProfile(baseYaml);
    const req = buildAutoAnswerPrompt(profile, [], { company: "Acme", title: "SWE", location: "LA", jdText: "Python" }, [
      { key: "python_years", label: "Years of Python experience?", options: ["0-1", "2-3", "4+"] },
    ]);
    expect(req.system).toMatch(/Never invent a fact/);
    expect(req.prompt).toContain("University of Southern California");
    expect(req.prompt).toContain('"needs_sponsorship": true');
    expect(req.prompt).toContain("python_years");
    expect(req.prompt).toContain('company="Acme"');
    expect(req.tier).toBe("smart");
  });

  it("parseAutoAnswers keeps only real questions, drops nulls and answers outside the options", () => {
    const qs = [
      { key: "python_years", label: "Years of Python?", options: ["0-1", "2-3", "4+"] },
      { key: "langs", label: "Languages", options: ["Python", "Go", "Rust"], multiple: true },
      { key: "gpa", label: "GPA" },
      { key: "free", label: "Start date?" },
    ];
    const out = parseAutoAnswers(
      JSON.stringify([
        { key: "python_years", answer: "2-3", reason: "harness in Python" },
        { key: "langs", answer: "Python; Rust" },
        { key: "gpa", answer: null, reason: "not in facts" },
        { key: "free", answer: "June 2027" },
        { key: "made_up", answer: "x" },
      ]),
      qs
    );
    expect(out).toEqual({ python_years: "2-3", langs: "Python; Rust", free: "June 2027" });
    expect(parseAutoAnswers(JSON.stringify([{ key: "python_years", answer: "5" }]), qs)).toEqual({});
    expect(parseAutoAnswers(JSON.stringify([{ key: "langs", answer: "Python; Java" }]), qs)).toEqual({});
  });

  it("answers every open text item: the row moves to prepared with the answers, remembered as standard answers", async () => {
    const db = openDb(":memory:");
    seedProfile(db);
    const jobId = seedJob(db);
    reportFill(db, U, {
      jobId,
      status: "needs_info",
      questions: [
        { key: "python_years", label: "Years of Python?", options: ["0-1", "2-3", "4+"] },
        { key: "start_date", label: "Earliest start date?" },
      ],
    });
    const backend = fakeBackend(
      JSON.stringify([
        { key: "python_years", answer: "2-3" },
        { key: "start_date", answer: "June 2027" },
      ])
    );
    const r = await autoAnswerPending(db, U, jobId, { backend });
    expect(r.status).toBe("prepared");
    expect(r.remaining).toEqual([]);
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].prompt).toContain("CUDA kernel tuner");
    const row = db.prepare("SELECT status, info_answers, pending_questions FROM applications WHERE job_id = ?").get(jobId) as {
      status: string;
      info_answers: string;
      pending_questions: string | null;
    };
    expect(row.status).toBe("prepared");
    expect(JSON.parse(row.info_answers)).toEqual({ python_years: "2-3", start_date: "June 2027" });
    expect(row.pending_questions).toBeNull();
    const saved = (getProfileData(db, U)?.standard_answers ?? {}) as Record<string, string>;
    expect(saved.python_years).toBe("2-3");
    expect(saved.city).toBe("Los Angeles");
  });

  it("keeps a card for what it cannot answer: unanswered required text items and file items stay, answered ones are stored", async () => {
    const db = openDb(":memory:");
    seedProfile(db);
    const jobId = seedJob(db);
    reportFill(db, U, {
      jobId,
      status: "needs_info",
      questions: [
        { key: "python_years", label: "Years of Python?", options: ["0-1", "2-3", "4+"] },
        { key: "gpa", label: "GPA" },
        { key: "nickname", label: "Preferred name", optional: true },
        { key: "transcript", label: "Transcript", kind: "file", accept: ".pdf" },
      ],
    });
    const backend = fakeBackend(JSON.stringify([{ key: "python_years", answer: "2-3" }, { key: "gpa", answer: null }]));
    const r = await autoAnswerPending(db, U, jobId, { backend });
    expect(r.status).toBe("needs_info");
    expect(r.remaining.map((q) => q.key)).toEqual(["gpa", "transcript"]);
    const row = db.prepare("SELECT status, info_answers, pending_questions FROM applications WHERE job_id = ?").get(jobId) as {
      status: string;
      info_answers: string;
      pending_questions: string;
    };
    expect(row.status).toBe("needs_info");
    expect(JSON.parse(row.info_answers)).toEqual({ python_years: "2-3" });
    expect(JSON.parse(row.pending_questions).map((q: { key: string }) => q.key)).toEqual(["gpa", "transcript"]);
  });

  it("a model failure leaves the ordinary card untouched", async () => {
    const db = openDb(":memory:");
    seedProfile(db);
    const jobId = seedJob(db);
    reportFill(db, U, { jobId, status: "needs_info", questions: [{ key: "gpa", label: "GPA" }] });
    const backend: LlmBackend = {
      name: "broken",
      async complete() {
        throw new Error("boom");
      },
    };
    const r = await autoAnswerPending(db, U, jobId, { backend });
    expect(r.status).toBe("needs_info");
    expect(r.error).toBe("boom");
    const row = db.prepare("SELECT status, pending_questions FROM applications WHERE job_id = ?").get(jobId) as { status: string; pending_questions: string };
    expect(row.status).toBe("needs_info");
    expect(JSON.parse(row.pending_questions)).toHaveLength(1);
  });

  it("does nothing without a complete profile or without text items", async () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db);
    reportFill(db, U, { jobId, status: "needs_info", questions: [{ key: "gpa", label: "GPA" }] });
    const backend = fakeBackend("[]");
    expect((await autoAnswerPending(db, U, jobId, { backend })).status).toBe("skipped");
    expect(backend.calls).toHaveLength(0);

    seedProfile(db);
    const jobId2 = seedJob(db);
    reportFill(db, U, { jobId: jobId2, status: "needs_info", questions: [{ key: "captcha", label: "Click the captcha", kind: "action" }] });
    expect((await autoAnswerPending(db, U, jobId2, { backend })).status).toBe("skipped");
    expect(backend.calls).toHaveLength(0);
  });
});
