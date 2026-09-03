import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type DB = Database.Database;

// Read lazily (inside openDb, not at module import time) so importing this module never
// touches the filesystem on its own — safe under Next's various build/runtime bundling modes.
// Resolve module-relative first (works regardless of process.cwd()); fall back to a
// cwd-relative path for bundling contexts where the module-relative URL doesn't resolve to
// the actual file on disk.
function readSchema(): string {
  try {
    return fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  } catch {
    return fs.readFileSync(path.join(process.cwd(), "src/lib/schema.sql"), "utf8");
  }
}

const SCHEMA_VERSION = 7;

export function openDb(file?: string): DB {
  const dbFile =
    file ??
    path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "jobseeker.db");
  if (dbFile !== ":memory:") fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Migration hook: read the schema version actually on disk before touching it, so future
  // plans can branch on `found` to run incremental migrations instead of blindly overwriting.
  const found = db.pragma("user_version", { simple: true }) as number;
  db.exec(readSchema());
  if (found > 0 && found < SCHEMA_VERSION) {
    // v2 -> v3: applications gained answer_pack/filled_fields/confirm_decision/needs_manual_reason.
    // CREATE TABLE IF NOT EXISTS above is a no-op on an existing table, so old DBs need explicit
    // ALTER TABLE ADD COLUMN — guarded per-column so this is safe to run more than once.
    const cols = (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map(
      (c) => c.name
    );
    for (const [col, type] of [
      ["answer_pack", "TEXT"],
      ["filled_fields", "TEXT"],
      ["confirm_decision", "TEXT"],
      ["needs_manual_reason", "TEXT"],
    ] as const) {
      if (!cols.includes(col)) db.exec(`ALTER TABLE applications ADD COLUMN ${col} ${type}`);
    }
    // v3 -> v4: executor_runs is a brand-new table, so CREATE TABLE IF NOT EXISTS above already
    // handles it on both fresh and pre-existing DBs — no ALTER needed here.
    // v4 -> v5: jobs gained loc_flag (US-only location hard filter, mirrors visa_flag).
    const jobCols = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map(
      (c) => c.name
    );
    if (!jobCols.includes("loc_flag")) db.exec("ALTER TABLE jobs ADD COLUMN loc_flag TEXT");
    // v5 -> v6: applications gained pinned (interactive /queue's "置顶" priority flag).
    const appCols = (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map(
      (c) => c.name
    );
    if (!appCols.includes("pinned")) db.exec("ALTER TABLE applications ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
    // v6 -> v7: executor_runs gained channel (headless | user_chrome, the attended-session
    // "值守会话" path that drives the user's own logged-in Chrome) and claimed_at (when an
    // attended session claimed a queued user_chrome row). New status value 'queued' needs no
    // column change — status is a free-text column.
    const runCols = (db.prepare("PRAGMA table_info(executor_runs)").all() as { name: string }[]).map(
      (c) => c.name
    );
    if (!runCols.includes("channel"))
      db.exec("ALTER TABLE executor_runs ADD COLUMN channel TEXT NOT NULL DEFAULT 'headless'");
    if (!runCols.includes("claimed_at")) db.exec("ALTER TABLE executor_runs ADD COLUMN claimed_at TEXT");
  }
  db.pragma(`user_version = ${SCHEMA_VERSION}`);

  return db;
}

// Hang the singleton on globalThis (rather than a module-scoped variable) so it survives
// Next dev's Fast Refresh / HMR module re-evaluation instead of silently reopening the db.
const globalForDb = globalThis as unknown as { __jsdb?: DB };
export function getDb(): DB {
  return (globalForDb.__jsdb ??= openDb());
}

export function logEvent(
  db: DB,
  kind: string,
  opts: { entity?: string; entityId?: number; payload?: unknown } = {}
): void {
  db.prepare("INSERT INTO events (kind, entity, entity_id, payload) VALUES (?,?,?,?)").run(
    kind,
    opts.entity ?? null,
    opts.entityId ?? null,
    JSON.stringify(opts.payload ?? {})
  );
}
