import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { selectResumeForJob, hasResumeFor, uploadedResumePath, UPLOADED_RESUME_VERSION } from "@/apply/resume-select";
import { saveDocument, userDocumentsDir } from "@/lib/documents";

// Rows seeded without a user land in the schema's default bucket.
const U = "legacy";

let dir: string;
let prevDataDir: string | undefined;
beforeEach(() => {
  prevDataDir = process.env.DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-resume-uploaded-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

function seedMatch(db: DB, direction: string | null): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, "Acme", "SWE", "https://acme.example/apply", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, direction, 80, 1);
  return jobId;
}

function upload(db: DB, name = "My Resume.pdf"): string {
  return saveDocument("resume", name, Buffer.from("%PDF-1.4 fake"), userDocumentsDir(db, U)).path;
}

describe("the user's own uploaded resume", () => {
  it("is used when no generated version covers the job's direction", () => {
    const db = openDb(":memory:");
    const jobId = seedMatch(db, "embedded");
    expect(selectResumeForJob(db, U, jobId)).toEqual({ error: "no_resume_for_direction", direction: "embedded" });
    const file = upload(db);
    expect(selectResumeForJob(db, U, jobId)).toEqual({ resumeId: null, pdfPath: file, versionName: UPLOADED_RESUME_VERSION });
  });

  it("also covers a job with no matched direction", () => {
    const db = openDb(":memory:");
    const jobId = seedMatch(db, null);
    upload(db);
    expect(selectResumeForJob(db, U, jobId)).toMatchObject({ resumeId: null, versionName: UPLOADED_RESUME_VERSION });
  });

  it("gives way to a generated version for the direction", () => {
    const db = openDb(":memory:");
    const jobId = seedMatch(db, "embedded");
    upload(db);
    const id = db
      .prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)")
      .run("embedded_v1", JSON.stringify(["embedded"]), path.join(dir, "resumes", "embedded_v1.pdf"), "2026-01-01 00:00:00").lastInsertRowid as number;
    expect(selectResumeForJob(db, U, jobId)).toMatchObject({ resumeId: id, versionName: "embedded_v1" });
  });

  it("counts for the start route's check; a picture saved under the key does not", () => {
    const db = openDb(":memory:");
    expect(hasResumeFor(db, U, "embedded")).toBe(false);
    saveDocument("resume", "scan.png", Buffer.from("png"), userDocumentsDir(db, U));
    expect(uploadedResumePath(db, U)).toBeNull();
    expect(hasResumeFor(db, U, "embedded")).toBe(false);
    upload(db, "cv.docx");
    expect(hasResumeFor(db, U, "embedded")).toBe(true);
    expect(hasResumeFor(db, U, null)).toBe(true);
  });
});
