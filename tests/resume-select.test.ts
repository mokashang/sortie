import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { selectResumeForJob } from "@/apply/resume-select";
import fs from "fs";
import os from "os";
import path from "path";
import { dataDir } from "@/lib/paths";

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

    const result = selectResumeForJob(db, jobId);

    expect(result).toEqual({ resumeId, pdfPath: path.join(dataDir(), "resumes", "ai_infra-v1.pdf"), versionName: "ai_infra-v1" });
  });

  it("writes the selected resume_id back onto the matches row", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, "ai_infra");
    const resumeId = insertResume(db, "ai_infra-v1", ["ai_infra"], "/data/r/ai_infra-v1.pdf", "2026-01-01 00:00:00");

    selectResumeForJob(db, jobId);

    const row = db.prepare("SELECT resume_id FROM matches WHERE job_id=?").get(jobId) as { resume_id: number };
    expect(row.resume_id).toBe(resumeId);
  });

  it("returns an error object when the job has no matched direction", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, null);

    const result = selectResumeForJob(db, jobId);

    expect(result).toEqual({ error: "no_resume_for_direction", direction: null });
  });

  it("returns an error object when the job was never matched at all", () => {
    const db = openDb(":memory:");
    const jobId = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
      .run("fp-unmatched", "A", "T", "s").lastInsertRowid as number;

    const result = selectResumeForJob(db, jobId);

    expect(result).toEqual({ error: "no_resume_for_direction", direction: null });
  });

  it("returns an error object when no resume version exists for the direction", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, "quant");
    insertResume(db, "ai_infra-v1", ["ai_infra"], "/data/r/ai_infra-v1.pdf", "2026-01-01 00:00:00");

    const result = selectResumeForJob(db, jobId);

    expect(result).toEqual({ error: "no_resume_for_direction", direction: "quant" });
  });

  it("picks the newest version when multiple resume versions match the direction", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, "ai_infra");
    insertResume(db, "ai_infra-v1", ["ai_infra"], "/data/r/ai_infra-v1.pdf", "2026-01-01 00:00:00");
    const newestId = insertResume(db, "ai_infra-v2", ["ai_infra"], "/data/r/ai_infra-v2.pdf", "2026-06-01 00:00:00");
    insertResume(db, "ai_infra-v0", ["ai_infra"], "/data/r/ai_infra-v0.pdf", "2025-01-01 00:00:00");

    const result = selectResumeForJob(db, jobId);

    expect(result).toEqual({ resumeId: newestId, pdfPath: path.join(dataDir(), "resumes", "ai_infra-v2.pdf"), versionName: "ai_infra-v2" });
  });

  it("hands out a Mac-era stored path re-based onto the current data dir (the 2026-09-02 rows after the move to Windows)", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, "ai_infra");
    // Hyphenated name: this exact file never existed on the Mac either, so the test is deterministic there too.
    const resumeId = insertResume(
      db,
      "ai_infra-v1",
      ["ai_infra"],
      "/Users/moka/Documents/job_seeker/data/resumes/ai_infra-v1.pdf",
      "2026-09-02 19:56:38"
    );

    const result = selectResumeForJob(db, jobId);

    expect(result).toEqual({ resumeId, pdfPath: path.join(dataDir(), "resumes", "ai_infra-v1.pdf"), versionName: "ai_infra-v1" });
  });

  it("leaves an absolute path alone when the file exists on this machine", () => {
    const db = openDb(":memory:");
    const jobId = makeJobWithDirection(db, "ai_infra");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-select-"));
    const file = path.join(dir, "ai_infra-v1.pdf");
    fs.writeFileSync(file, "%PDF");
    try {
      const resumeId = insertResume(db, "ai_infra-v1", ["ai_infra"], file, "2026-01-01 00:00:00");
      expect(selectResumeForJob(db, jobId)).toEqual({ resumeId, pdfPath: file, versionName: "ai_infra-v1" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
