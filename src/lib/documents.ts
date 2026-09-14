import fs from "fs";
import path from "path";

// Standing documents the apply executor can upload into forms besides the resume: transcripts,
// a cover-letter template, a portfolio PDF, a headshot. One file per key, kept as
// data/documents/<key>.<ext> under DATA_DIR (the same tree the resume PDFs live in — the
// Chrome file_upload tool only accepts files inside the project's data directory). The
// filesystem is the registry: there is no table, listDocuments() just reads the folder, and the
// answer pack's `documents` map is documentsMap(). Managed from /profile's 文件 tab and from a
// 待处理 card's file item (spec 2026-09-13-todo-list-design §1).

export const DOCUMENT_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const DOCUMENT_EXTS = [".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".txt"];
export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;

export interface DocumentRow {
  key: string;
  filename: string;
  path: string; // absolute
  size: number;
  updatedAt: string; // ISO
}

export function documentsDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "documents");
}

export function isValidDocumentKey(key: string): boolean {
  return DOCUMENT_KEY_RE.test(key);
}

// Extension check on the ORIGINAL filename the user picked — that's the only signal we have of
// what the file is; the stored name is always <key><ext> so a later upload for the same key
// with a different extension replaces the old file cleanly (see saveDocument).
export function documentExtension(originalName: string): string | null {
  const ext = path.extname(originalName).toLowerCase();
  return DOCUMENT_EXTS.includes(ext) ? ext : null;
}

export function listDocuments(dir = documentsDir()): DocumentRow[] {
  if (!fs.existsSync(dir)) return [];
  const rows: DocumentRow[] = [];
  for (const name of fs.readdirSync(dir)) {
    const ext = path.extname(name).toLowerCase();
    const key = name.slice(0, name.length - ext.length);
    if (!DOCUMENT_EXTS.includes(ext) || !isValidDocumentKey(key)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (!st.isFile()) continue;
    rows.push({ key, filename: name, path: full, size: st.size, updatedAt: st.mtime.toISOString() });
  }
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return rows;
}

// key -> absolute path, what the answer pack carries so the executor can `file_upload` a
// transcript without asking.
export function documentsMap(dir = documentsDir()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of listDocuments(dir)) out[d.key] = d.path;
  return out;
}

export function saveDocument(key: string, originalName: string, bytes: Buffer, dir = documentsDir()): DocumentRow {
  if (!isValidDocumentKey(key)) throw new Error(`saveDocument: invalid key '${key}' (a-z, 0-9, _; must start with a letter)`);
  const ext = documentExtension(originalName);
  if (!ext) throw new Error(`saveDocument: unsupported file type '${path.extname(originalName) || "(none)"}' (allowed: ${DOCUMENT_EXTS.join(" ")})`);
  if (bytes.length === 0) throw new Error("saveDocument: empty file");
  if (bytes.length > DOCUMENT_MAX_BYTES) throw new Error(`saveDocument: file larger than ${DOCUMENT_MAX_BYTES / 1024 / 1024} MB`);
  fs.mkdirSync(dir, { recursive: true });
  // One file per key: a re-upload with another extension must not leave the old one behind.
  for (const old of listDocuments(dir)) if (old.key === key && old.filename !== key + ext) fs.rmSync(old.path, { force: true });
  const full = path.join(dir, key + ext);
  fs.writeFileSync(full, bytes);
  const st = fs.statSync(full);
  return { key, filename: key + ext, path: full, size: st.size, updatedAt: st.mtime.toISOString() };
}

export function deleteDocument(key: string, dir = documentsDir()): boolean {
  let removed = false;
  for (const d of listDocuments(dir)) {
    if (d.key !== key) continue;
    fs.rmSync(d.path, { force: true });
    removed = true;
  }
  return removed;
}

// A file-item answer is the absolute path the upload returned; refuse anything that isn't an
// existing file inside the documents folder so a path typed by hand can't point the executor's
// file_upload at an arbitrary file on the machine.
export function isDocumentPath(p: string, dir = documentsDir()): boolean {
  if (typeof p !== "string" || !p) return false;
  const resolved = path.resolve(p);
  const base = path.resolve(dir);
  if (resolved === base) return false;
  const rel = path.relative(base, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel) || rel.includes(path.sep)) return false;
  try {
    return fs.statSync(resolved).isFile();
  } catch {
    return false;
  }
}
