import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { parseProfile, Profile } from "@/lib/profile";
import {
  takeNextApplication,
  reportFill,
  decide,
  reportSubmitted,
  pendingConfirmations,
  confirmStatus,
  ApplyTask,
} from "@/apply/queue";

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
`;

function testProfile(): Profile {
  return parseProfile(baseYaml);
}

function seedJob(
  db: DB,
  opts: {
    fingerprint?: string;
    company?: string;
    title?: string;
    applyUrl?: string;
    ats?: string;
    tier?: number | null;
    score?: number;
    direction?: string | null;
    status?: string;
    createdAt?: string;
  } = {}
): number {
  const jobId = db
    .prepare(
      "INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(
      opts.fingerprint ?? `fp-${Math.random()}`,
      opts.company ?? "Acme",
      opts.title ?? "SWE",
      opts.applyUrl ?? "https://acme.example/apply",
      opts.ats ?? "greenhouse",
      "manual",
      opts.createdAt ?? "2026-01-01 00:00:00"
    ).lastInsertRowid as number;

  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(
    jobId,
    opts.direction === undefined ? "ai_infra" : opts.direction,
    opts.score ?? 80,
    opts.tier === undefined ? 1 : opts.tier
  );

  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(jobId, opts.status ?? "matched");

  return jobId;
}

function seedResume(
  db: DB,
  versionName: string,
  directions: string[],
  pdfPath = "/data/r/x.pdf",
  compiledAt = "2026-01-01 00:00:00"
): number {
  return db
    .prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)")
    .run(versionName, JSON.stringify(directions), pdfPath, compiledAt).lastInsertRowid as number;
}

function getApplication(db: DB, jobId: number) {
  return db.prepare("SELECT * FROM applications WHERE job_id=?").get(jobId) as Record<string, unknown>;
}

describe("takeNextApplication", () => {
  it("returns { done: true } when there is nothing in the matched queue", () => {
    const db = openDb(":memory:");
    const result = takeNextApplication(db, testProfile());
    expect(result).toEqual({ done: true });
  });

  it("picks the highest-priority job: lower tier first, then higher score, then newest", () => {
    const db = openDb(":memory:");
    seedResume(db, "ai_infra-v1", ["ai_infra"]);
    // Deliberately seeded out of priority order.
    const lowTier = seedJob(db, { company: "LowTierCo", tier: 2, score: 99, createdAt: "2026-01-05 00:00:00" });
    const highTierLowScore = seedJob(db, {
      company: "HighTierLowScore",
      tier: 1,
      score: 50,
      createdAt: "2026-01-01 00:00:00",
    });
    const highTierHighScore = seedJob(db, {
      company: "HighTierHighScore",
      tier: 1,
      score: 90,
      createdAt: "2026-01-02 00:00:00",
    });
    void lowTier;
    void highTierLowScore;

    const result = takeNextApplication(db, testProfile()) as ApplyTask;

    expect(result.jobId).toBe(highTierHighScore);
    expect(result.company).toBe("HighTierHighScore");
  });

  it("treats a NULL tier as lowest priority (COALESCE to 9)", () => {
    const db = openDb(":memory:");
    seedResume(db, "ai_infra-v1", ["ai_infra"]);
    const nullTier = seedJob(db, { company: "NullTier", tier: null, score: 100 });
    const tiered = seedJob(db, { company: "Tiered", tier: 3, score: 1 });
    void nullTier;

    const result = takeNextApplication(db, testProfile()) as ApplyTask;

    expect(result.jobId).toBe(tiered);
  });

  it("locks the taken job by advancing status to prepared, so a second take skips it", () => {
    const db = openDb(":memory:");
    seedResume(db, "ai_infra-v1", ["ai_infra"]);
    const first = seedJob(db, { company: "First", tier: 1, score: 90 });
    const second = seedJob(db, { company: "Second", tier: 1, score: 50 });

    const firstTask = takeNextApplication(db, testProfile()) as ApplyTask;
    expect(firstTask.jobId).toBe(first);
    expect(getApplication(db, first).status).toBe("prepared");

    const secondTask = takeNextApplication(db, testProfile()) as ApplyTask;
    expect(secondTask.jobId).toBe(second);
  });

  it("returns a full ApplyTask with answer pack on success", () => {
    const db = openDb(":memory:");
    seedResume(db, "ai_infra-v1", ["ai_infra"], "/data/r/ai_infra-v1.pdf");
    const jobId = seedJob(db, {
      company: "Stripe",
      title: "SWE New Grad",
      applyUrl: "https://job-boards.greenhouse.io/stripe/jobs/1",
      ats: "greenhouse",
    });

    const result = takeNextApplication(db, testProfile()) as ApplyTask;

    expect(result).toMatchObject({
      jobId,
      company: "Stripe",
      title: "SWE New Grad",
      applyUrl: "https://job-boards.greenhouse.io/stripe/jobs/1",
      ats: "greenhouse",
    });
    expect(result.answerPack.contact.first_name).toBe("Mengjia");
    expect(result.answerPack.resume).toEqual({ version_name: "ai_infra-v1", pdf_path: "/data/r/ai_infra-v1.pdf" });
  });

  it("writes the answer_pack JSON onto the applications row", () => {
    const db = openDb(":memory:");
    seedResume(db, "ai_infra-v1", ["ai_infra"]);
    const jobId = seedJob(db, {});

    takeNextApplication(db, testProfile());

    const row = getApplication(db, jobId);
    expect(JSON.parse(row.answer_pack as string).contact.email).toBe("shangmengjiajiajia@gmail.com");
  });

  it("parks a job with no resume for its direction (needs_manual_reason set, status stays matched) and moves on to the next candidate", () => {
    const db = openDb(":memory:");
    // No resume exists for "quant" — noResume job should be skipped, not returned.
    const noResume = seedJob(db, { company: "NoResumeCo", direction: "quant", tier: 1, score: 99 });
    seedResume(db, "ai_infra-v1", ["ai_infra"]);
    const hasResume = seedJob(db, { company: "HasResumeCo", direction: "ai_infra", tier: 2, score: 1 });

    const result = takeNextApplication(db, testProfile()) as ApplyTask;

    expect(result.jobId).toBe(hasResume);
    const parked = getApplication(db, noResume);
    expect(parked.status).toBe("matched");
    expect(parked.needs_manual_reason).toBeTruthy();
  });

  it("does not re-pick a parked (needs_manual_reason set) job on a later call", () => {
    const db = openDb(":memory:");
    const noResume = seedJob(db, { company: "NoResumeCo", direction: "quant" });
    void noResume;

    const result = takeNextApplication(db, testProfile());

    expect(result).toEqual({ done: true });
  });
});

describe("reportFill", () => {
  it("transitions prepared -> awaiting_confirm and writes filled_fields", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "prepared" });

    reportFill(db, { jobId, status: "awaiting_confirm", filledFields: { email: "a@b.c" } });

    const row = getApplication(db, jobId);
    expect(row.status).toBe("awaiting_confirm");
    expect(JSON.parse(row.filled_fields as string)).toEqual({ email: "a@b.c" });
    expect(row.confirm_decision).toBeNull();
  });

  it("allows idempotent re-report from awaiting_confirm", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "awaiting_confirm" });

    expect(() =>
      reportFill(db, { jobId, status: "awaiting_confirm", filledFields: { email: "x@y.z" } })
    ).not.toThrow();
    expect(getApplication(db, jobId).status).toBe("awaiting_confirm");
  });

  it("needs_manual sets needs_manual_reason and parks status back to matched", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "prepared" });

    reportFill(db, { jobId, status: "needs_manual", reason: "registration wall" });

    const row = getApplication(db, jobId);
    expect(row.status).toBe("matched");
    expect(row.needs_manual_reason).toBe("registration wall");
  });

  it("error prefixes the reason with 'error: ' and parks status back to matched", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "prepared" });

    reportFill(db, { jobId, status: "error", reason: "upload timed out" });

    const row = getApplication(db, jobId);
    expect(row.status).toBe("matched");
    expect(row.needs_manual_reason).toBe("error: upload timed out");
  });

  it("rejects a report from an invalid from-state (e.g. matched)", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "matched" });

    expect(() => reportFill(db, { jobId, status: "awaiting_confirm", filledFields: {} })).toThrow();
  });

  it("rejects a report from an invalid from-state (e.g. submitted)", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "submitted" });

    expect(() => reportFill(db, { jobId, status: "needs_manual", reason: "x" })).toThrow();
  });
});

describe("decide", () => {
  it("approve sets confirm_decision='approved' and leaves status at awaiting_confirm", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "awaiting_confirm" });

    decide(db, jobId, "approve");

    const row = getApplication(db, jobId);
    expect(row.confirm_decision).toBe("approved");
    expect(row.status).toBe("awaiting_confirm");
  });

  it("reject sends status back to matched, sets confirm_decision='rejected', and records the reason", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "awaiting_confirm" });

    decide(db, jobId, "reject", "bad fill");

    const row = getApplication(db, jobId);
    expect(row.status).toBe("matched");
    expect(row.confirm_decision).toBe("rejected");
    expect(row.needs_manual_reason).toBe("bad fill");
  });

  it("reject without a reason defaults to 'user rejected fill'", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "awaiting_confirm" });

    decide(db, jobId, "reject");

    expect(getApplication(db, jobId).needs_manual_reason).toBe("user rejected fill");
  });
});

describe("reportSubmitted — red line", () => {
  it("throws when there is no approved confirm_decision", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "awaiting_confirm" });

    expect(() => reportSubmitted(db, jobId)).toThrow();
    expect(getApplication(db, jobId).status).toBe("awaiting_confirm");
  });

  it("throws when confirm_decision is 'rejected'", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "awaiting_confirm" });
    decide(db, jobId, "reject");

    expect(() => reportSubmitted(db, jobId)).toThrow();
  });

  it("throws when status has drifted away from awaiting_confirm even if somehow approved", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "prepared" });
    db.prepare("UPDATE applications SET confirm_decision='approved' WHERE job_id=?").run(jobId);

    expect(() => reportSubmitted(db, jobId)).toThrow();
  });

  it("succeeds after approve: status -> submitted, submitted_at set", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "awaiting_confirm" });
    decide(db, jobId, "approve");

    reportSubmitted(db, jobId);

    const row = getApplication(db, jobId);
    expect(row.status).toBe("submitted");
    expect(row.submitted_at).toBeTruthy();
  });
});

describe("pendingConfirmations", () => {
  it("returns awaiting_confirm rows with company/title/direction/score/filledFields/resume version", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, {
      company: "Stripe",
      title: "SWE",
      direction: "ai_infra",
      score: 88,
      status: "awaiting_confirm",
    });
    db.prepare("UPDATE applications SET filled_fields=?, answer_pack=? WHERE job_id=?").run(
      JSON.stringify({ email: "a@b.c" }),
      JSON.stringify({ resume: { version_name: "ai_infra-v1" } }),
      jobId
    );

    const rows = pendingConfirmations(db);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      jobId,
      company: "Stripe",
      title: "SWE",
      direction: "ai_infra",
      score: 88,
      filledFields: { email: "a@b.c" },
      resumeVersion: "ai_infra-v1",
    });
  });

  it("excludes jobs that are not awaiting_confirm", () => {
    const db = openDb(":memory:");
    seedJob(db, { status: "matched" });
    seedJob(db, { status: "prepared" });
    seedJob(db, { status: "submitted" });

    expect(pendingConfirmations(db)).toEqual([]);
  });
});

describe("confirmStatus", () => {
  it("returns decision and status for a job", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "awaiting_confirm" });
    decide(db, jobId, "approve");

    expect(confirmStatus(db, jobId)).toEqual({ decision: "approved", status: "awaiting_confirm" });
  });

  it("returns a null decision before any decide() call", () => {
    const db = openDb(":memory:");
    const jobId = seedJob(db, { status: "prepared" });

    expect(confirmStatus(db, jobId)).toEqual({ decision: null, status: "prepared" });
  });
});
