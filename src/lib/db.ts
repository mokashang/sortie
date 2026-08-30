import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export type DB = Database.Database;

// Read lazily (inside openDb, not at module import time) so importing this module never
// touches the filesystem on its own — safe under Next's various build/runtime bundling modes.
function readSchema(): string {
  return fs.readFileSync(path.join(process.cwd(), "src/lib/schema.sql"), "utf8");
}

export function openDb(file?: string): DB {
  const dbFile =
    file ??
    path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "jobseeker.db");
  if (dbFile !== ":memory:") fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("user_version = 1"); // migration hook for later plans
  db.exec(readSchema());
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
