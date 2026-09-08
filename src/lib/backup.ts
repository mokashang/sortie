import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Daily online backup of data/jobseeker.db (spec §3: the Windows box is the only copy of the data).
// Uses SQLite's backup API through better-sqlite3, so it is consistent even while the server is
// writing, and prunes the automated backups older than keepDays. Hand-made backups (any other
// file name, e.g. jobseeker-2026-09-05-pre-dedup.db) are never touched.

export const AUTO_BACKUP_RE = /^jobseeker-(\d{4})-(\d{2})-(\d{2})\.db$/;

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function backupFileName(day: Date): string {
  return `jobseeker-${localDay(day)}.db`;
}

export function selectBackupsToPrune(names: string[], today: Date, keepDays: number): string[] {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays);
  return names.filter((n) => {
    const m = AUTO_BACKUP_RE.exec(n);
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d < cutoff;
  });
}

export interface BackupOptions {
  src: string;
  outDir: string;
  today?: Date;
  keepDays?: number;
}
export interface BackupResult {
  dest: string;
  bytes: number;
  pruned: string[];
}

export async function backupDatabase(opts: BackupOptions): Promise<BackupResult> {
  const today = opts.today ?? new Date();
  const keepDays = opts.keepDays ?? 14;
  fs.mkdirSync(opts.outDir, { recursive: true });
  const dest = path.join(opts.outDir, backupFileName(today));
  const db = new Database(opts.src, { fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const pruned = selectBackupsToPrune(fs.readdirSync(opts.outDir), today, keepDays);
  for (const n of pruned) fs.unlinkSync(path.join(opts.outDir, n));
  return { dest, bytes: fs.statSync(dest).size, pruned };
}
