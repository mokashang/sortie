import fs from "fs";
import path from "path";

// Where the app keeps everything it owns at runtime: the SQLite database, compiled resumes,
// executor logs, backups. DATA_DIR overrides; the default is <cwd>/data. openDb, the resume
// generator and the backup script used to spell this rule out separately.
export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function resumesDir(base: string = dataDir()): string {
  return path.join(base, "resumes");
}

// A stored path may have been written on macOS (/Users/...) and be read on Windows, or the other
// way round, so "absolute" has to mean absolute in EITHER spelling. path.win32.isAbsolute accepts
// a POSIX root, a drive letter and a UNC prefix; path.posix.isAbsolute rejects drive letters.
function isAbsoluteOnAnyPlatform(p: string): boolean {
  return path.win32.isAbsolute(p) || path.posix.isAbsolute(p);
}

// path.win32.basename splits on both separators; path.posix.basename only on "/".
function basenameOnAnyPlatform(p: string): string {
  return path.win32.basename(p);
}

export interface ResolveResumePathOptions {
  dataDir?: string;
  exists?: (p: string) => boolean;
}

// Turns a resumes.pdf_path / tex_path value as stored in the DB into a path that is valid on
// THIS machine. The rows compiled on the Mac on 2026-09-02 store absolute Mac paths
// (/Users/moka/Documents/job_seeker/data/resumes/x.pdf); after the 2026-09-11 move to Windows
// those files live under <DATA_DIR>/resumes with the same basenames, and the attended session
// had to rewrite the path by hand on every upload (run #68). Rules, in order:
//   1. empty                -> ""
//   2. relative             -> <dataDir>/<stored>            (what generateResume stores now)
//   3. absolute and present -> unchanged                     (compiled here, or a custom outDir)
//   4. absolute and missing -> <dataDir>/resumes/<basename>  (the leftover from another machine)
// Rule 4 does not check that the fallback exists either: the caller that cares (the download
// route) checks the resolved path itself, and a wrong-but-local path is a far better error to see
// than a Mac path on a Windows box.
export function resolveResumePath(stored: string | null | undefined, opts: ResolveResumePathOptions = {}): string {
  if (!stored) return "";
  const base = opts.dataDir ?? dataDir();
  const exists = opts.exists ?? fs.existsSync;
  if (!isAbsoluteOnAnyPlatform(stored)) return path.join(base, stored);
  if (exists(stored)) return stored;
  return path.join(resumesDir(base), basenameOnAnyPlatform(stored));
}

// The write-side counterpart: a compiled file inside the data dir is stored relative to it, with
// forward slashes ("resumes/x.pdf"), so the row keeps meaning something after the data dir moves
// to another machine or OS. A file outside the data dir (tests, a custom outDir) keeps its
// absolute path; resolveResumePath rule 3 still finds it as long as it stays where it is.
export function toStoredResumePath(absPath: string, base: string = dataDir()): string {
  const rel = path.relative(path.resolve(base), path.resolve(absPath));
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return absPath;
  return rel.split(path.sep).join("/");
}
