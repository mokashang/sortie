import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "src/lib/schema.sql"), "utf8");

export type DB = Database.Database;

export function openDb(file?: string): DB {
  const dbFile =
    file ??
    path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "jobseeker.db");
  if (dbFile !== ":memory:") fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

let singleton: DB | null = null;
export function getDb(): DB {
  if (!singleton) singleton = openDb();
  return singleton;
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
