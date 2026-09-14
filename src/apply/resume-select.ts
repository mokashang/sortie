import { DB } from "@/lib/db";
import { resolveResumePath } from "@/lib/paths";

export interface ResumeSelection {
  resumeId: number;
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

// Picks the resume version to attach to a job's application: looks up the direction the matcher
// assigned (matches.direction), then finds the newest resumes row whose `directions` JSON array
// contains that direction slug. Writes the chosen resume_id back onto the matches row so it's
// recorded which version was actually used. Returns an error object (never throws) when there's
// no direction to work from, or no resume has been generated for it yet — the caller is expected
// to surface this as a "needs_manual" case ("go generate that direction's resume in Studio first").
// pdfPath is resolved against the current data dir (resolveResumePath): the row may have been
// compiled on another machine (the 2026-09-02 versions store Mac paths) and the executor needs a
// path that exists here.
export function selectResumeForJob(db: DB, jobId: number): ResumeSelection | ResumeSelectionError {
  const match = db.prepare("SELECT direction FROM matches WHERE job_id = ?").get(jobId) as
    | { direction: string | null }
    | undefined;
  const direction = match?.direction ?? null;
  if (!direction) return { error: "no_resume_for_direction", direction: null };

  const candidates = (
    db.prepare("SELECT id, version_name, directions, pdf_path, compiled_at FROM resumes").all() as ResumeRow[]
  ).filter((r) => {
    try {
      return (JSON.parse(r.directions) as string[]).includes(direction);
    } catch {
      return false;
    }
  });
  if (candidates.length === 0) return { error: "no_resume_for_direction", direction };

  // Newest first: compiled_at (ISO-ish "datetime('now')" strings sort lexically) then id as a
  // tiebreak for equal/NULL timestamps.
  candidates.sort((a, b) => {
    const byDate = (b.compiled_at ?? "").localeCompare(a.compiled_at ?? "");
    return byDate !== 0 ? byDate : b.id - a.id;
  });
  const chosen = candidates[0];

  db.prepare("UPDATE matches SET resume_id = ? WHERE job_id = ?").run(chosen.id, jobId);

  return { resumeId: chosen.id, pdfPath: resolveResumePath(chosen.pdf_path), versionName: chosen.version_name };
}
