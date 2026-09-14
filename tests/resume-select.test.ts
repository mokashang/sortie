import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { selectResumeForJob } from "@/apply/resume-select";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

function makeJobWithDirection(db: DB, direction: string | null): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
    .run(`fp-${Math.random()}`, "Stripe", "SWE", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, direction, 80, 1);
  return jobId;
}

function insertResume(
  db: DB,
  versionName: string,
  directions: string[],
  pdfPath: string,
  compiledAt: string
): number {
  return db
    .prepare(
      "INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)"
    )
    .run(versionName, JSON.stringify(directions), pdfPath, compiledAt).lastInsertRowid as number;
}

describe("selectResumeForJob", () => {
  it("selects the resume whose directions include the job's matched direction", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, "ai_infra");
    const resumeId = insertResume(db, "ai_infra-v1", ["ai_infra"], "/data/r/ai_infra-v1.pdf", "2026-01-01 00:00:00");

    const result = selectResumeForJob(db, U, jobId);

    expect(result).toEqual({ resumeId, pdfPath: "/data/r/ai_infra-v1.pdf", versionName: "ai_infra-v1" });
  });

  it("writes the selected resume_id back onto the matches row", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, "ai_infra");
    const resumeId = insertResume(db, "ai_infra-v1", ["ai_infra"], "/data/r/ai_infra-v1.pdf", "2026-01-01 00:00:00");

    selectResumeForJob(db, U, jobId);

    const row = db.prepare("SELECT resume_id FROM matches WHERE job_id=?").get(jobId) as { resume_id: number };
    expect(row.resume_id).toBe(resumeId);
  });

  it("returns an error object when the job has no matched direction", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, null);

    const result = selectResumeForJob(db, U, jobId);

    expect(result).toEqual({ error: "no_resume_for_direction", direction: null });
  });

  it("returns an error object when the job was never matched at all", () => {
    const db = openDb(":memory:");
    const jobId = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
      .run("fp-unmatched", "A", "T", "s").lastInsertRowid as number;

    const result = selectResumeForJob(db, U, jobId);

    expect(result).toEqual({ error: "no_resume_for_direction", direction: null });
  });

  it("returns an error object when no resume version exists for the direction", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, "quant");
    insertResume(db, "ai_infra-v1", ["ai_infra"], "/data/r/ai_infra-v1.pdf", "2026-01-01 00:00:00");

    const result = selectResumeForJob(db, U, jobId);

    expect(result).toEqual({ error: "no_resume_for_direction", direction: "quant" });
  });

  it("picks the newest version when multiple resume versions match the direction", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, "ai_infra");
    insertResume(db, "ai_infra-v1", ["ai_infra"], "/data/r/ai_infra-v1.pdf", "2026-01-01 00:00:00");
    const newestId = insertResume(db, "ai_infra-v2", ["ai_infra"], "/data/r/ai_infra-v2.pdf", "2026-06-01 00:00:00");
    insertResume(db, "ai_infra-v0", ["ai_infra"], "/data/r/ai_infra-v0.pdf", "2025-01-01 00:00:00");

    const result = selectResumeForJob(db, U, jobId);

    expect(result).toEqual({ resumeId: newestId, pdfPath: "/data/r/ai_infra-v2.pdf", versionName: "ai_infra-v2" });
  });
});
