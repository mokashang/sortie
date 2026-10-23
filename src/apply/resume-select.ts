import { DB } from "@/lib/db";
import { resolveResumePath } from "@/lib/paths";
import { listDocuments, userDocumentsDir } from "@/lib/documents";

export interface ResumeSelection {
  // null = the resume the user uploaded themselves (档案 → 简历 → 上传), not a generated version.
  resumeId: number | null;
  pdfPath: string;
  versionName: string;
}

export interface ResumeSelectionError {
  error: "no_resume_for_direction";
  direction: string | null;
}

interface ResumeRow {
  id: number;
  version_name: string;
  directions: string;
  pdf_path: string | null;
  compiled_at: string | null;
}

// The document key an uploaded resume is stored under (data/…/documents/resume.pdf), and the
// file types an application form takes as a resume.
export const UPLOADED_RESUME_KEY = "resume";
const RESUME_EXTS = [".pdf", ".doc", ".docx"];
export const UPLOADED_RESUME_VERSION = "uploaded";

// The resume the user uploaded, if any (absolute path). Every account's own documents folder.
export function uploadedResumePath(db: DB, userId: string): string | null {
  const doc = listDocuments(userDocumentsDir(db, userId)).find(
    (d) => d.key === UPLOADED_RESUME_KEY && RESUME_EXTS.some((ext) => d.filename.toLowerCase().endsWith(ext))
  );
  return doc?.path ?? null;
}

function generatedFor(db: DB, userId: string, direction: string): ResumeRow[] {
  return (
    db.prepare("SELECT id, version_name, directions, pdf_path, compiled_at FROM resumes WHERE user_id = ?").all(userId) as ResumeRow[]
  ).filter((r) => {
    try {
      return (JSON.parse(r.directions) as string[]).includes(direction);
    } catch {
      return false;
    }
  });
}

// Is there any resume an application in `direction` could carry — a generated version for it,
// or the user's own upload? (The start route refuses a plan the assistant could not attach a
// resume to, instead of parking every job it takes.)
export function hasResumeFor(db: DB, userId: string, direction: string | null): boolean {
  if (uploadedResumePath(db, userId)) return true;
  return direction != null && generatedFor(db, userId, direction).length > 0;
}

// Picks the resume version to attach to a job's application: looks up the direction the matcher
// assigned (matches.direction), then finds the newest of this user's resumes whose `directions`
// JSON array contains that direction slug. Writes the chosen resume_id back onto the matches row
// so it's recorded which version was actually used. With no generated version for the direction
// (or no direction at all), the resume the user uploaded is used as is (2026-10-22: a new account
// has a resume of its own long before it has a 38-entry experience bank to generate versions
// from). Returns an error object (never throws) only when there is neither. pdfPath is resolved
// against the current data dir (resolveResumePath): the row may have been compiled on another
// machine (the 2026-09-02 versions store Mac paths) and the executor needs a path that exists here.
export function selectResumeForJob(db: DB, userId: string, jobId: number): ResumeSelection | ResumeSelectionError {
  const match = db.prepare("SELECT direction FROM matches WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
    | { direction: string | null }
    | undefined;
  const direction = match?.direction ?? null;
  const candidates = direction ? generatedFor(db, userId, direction) : [];
  if (candidates.length === 0) {
    const uploaded = uploadedResumePath(db, userId);
    if (uploaded) return { resumeId: null, pdfPath: uploaded, versionName: UPLOADED_RESUME_VERSION };
    return { error: "no_resume_for_direction", direction };
  }

  // Newest first: compiled_at (ISO-ish "datetime('now')" strings sort lexically) then id as a
  // tiebreak for equal/NULL timestamps.
  candidates.sort((a, b) => {
    const byDate = (b.compiled_at ?? "").localeCompare(a.compiled_at ?? "");
    return byDate !== 0 ? byDate : b.id - a.id;
  });
  const chosen = candidates[0];

  db.prepare("UPDATE matches SET resume_id = ? WHERE user_id = ? AND job_id = ?").run(chosen.id, userId, jobId);

  return { resumeId: chosen.id, pdfPath: resolveResumePath(chosen.pdf_path), versionName: chosen.version_name };
}
