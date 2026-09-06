import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { dedupKey } from "@/scanner/fingerprint";
import { jdStatusFor } from "@/scanner/jd-status";
import { parseBoard, atsFromUrl } from "@/scanner/board-key";
import { discoverBoardsFromJobs } from "@/scanner/boards";
import { retierAll } from "@/scanner/retier";

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

const SCHEMA_VERSION = 13;

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
    // v7 -> v8: applications gained pending_questions / info_answers (the in-App "待补信息" flow:
    // executor asks, App notifies, user answers on /apply, executor continues). New status value
    // 'needs_info' needs no column change.
    const appCols8 = (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map((c) => c.name);
    if (!appCols8.includes("pending_questions")) db.exec("ALTER TABLE applications ADD COLUMN pending_questions TEXT");
    if (!appCols8.includes("info_answers")) db.exec("ALTER TABLE applications ADD COLUMN info_answers TEXT");
    // v8 -> v9: referral-in-apply. matches gained referral_fit/referral_reason (Claude's
    // "worth seeking a referral?" classification); applications gained apply_mode (user
    // override), referral_info (JSON, once a referral is obtained) and referral_reached_at.
    // outreach_jobs is a new table — CREATE TABLE IF NOT EXISTS above already created it.
    const matchCols = (db.prepare("PRAGMA table_info(matches)").all() as { name: string }[]).map((c) => c.name);
    if (!matchCols.includes("referral_fit")) db.exec("ALTER TABLE matches ADD COLUMN referral_fit INTEGER");
    if (!matchCols.includes("referral_reason")) db.exec("ALTER TABLE matches ADD COLUMN referral_reason TEXT");
    const appCols9 = (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map((c) => c.name);
    for (const col of ["apply_mode", "referral_info", "referral_reached_at"] as const) {
      if (!appCols9.includes(col)) db.exec(`ALTER TABLE applications ADD COLUMN ${col} TEXT`);
    }
    // v9 -> v10: jobs gained the dedup/eligibility/jd_status columns (spec 2026-09-03 scan-precision-dedup §3).
    const jobCols10 = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
    for (const [col, type] of [
      ["dedup_key", "TEXT"],
      ["duplicate_of", "INTEGER REFERENCES jobs(id)"],
      ["dedup_judged_at", "TEXT"],
      ["sponsorship", "TEXT"],
      ["degree_req", "TEXT"],
      ["role_kind", "TEXT"],
      ["elig_source", "TEXT"],
      ["jd_status", "TEXT"],
    ] as const) {
      if (!jobCols10.includes(col)) db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${type}`);
    }
    // Backfill in JS: norm() lives in TS, not SQL. Only rows never keyed — re-runnable.
    const pending = db.prepare("SELECT id, company, title, jd_text FROM jobs WHERE dedup_key IS NULL").all() as
      { id: number; company: string; title: string; jd_text: string | null }[];
    const upd = db.prepare("UPDATE jobs SET dedup_key = ?, jd_status = ? WHERE id = ?");
    const tx = db.transaction(() => {
      for (const r of pending) upd.run(dedupKey(r.company, r.title), jdStatusFor(r.jd_text), r.id);
    });
    tx();
    // v10 -> v11: outreach gained draft_note — the ≤280-char LinkedIn connection-note variant the
    // draft engine now produces alongside the full DM text (referral follow-up: the attended
    // session picks the variant by how the person is reachable, never edits text itself).
    const outreachCols11 = (db.prepare("PRAGMA table_info(outreach)").all() as { name: string }[]).map((c) => c.name);
    if (!outreachCols11.includes("draft_note")) db.exec("ALTER TABLE outreach ADD COLUMN draft_note TEXT");
    // v12 -> v13: outreach gained the referral-conversation monitor columns (referral_stage /
    // stage_summary / stage_action / stage_link / last_checked_at — src/network/harvest.ts). New
    // status value 'accepted' (invite accepted, no reply yet) needs no column change.
    const outreachCols13 = (db.prepare("PRAGMA table_info(outreach)").all() as { name: string }[]).map((c) => c.name);
    for (const col of ["referral_stage", "stage_summary", "stage_action", "stage_link", "last_checked_at"] as const) {
      if (!outreachCols13.includes(col)) db.exec(`ALTER TABLE outreach ADD COLUMN ${col} TEXT`);
    }
    // v11 -> v12: boards 注册表 + jobs.board_key(spec 2026-09-06 job-sources §1)。boards 表由上面的
    // CREATE TABLE IF NOT EXISTS 建好;这里给老 jobs 加列、按 apply_url 回填 board_key/ats,并把解析出的
    // 板块登记进 boards(origin=url)。只处理 board_key 仍为空的行 —— 可重跑。
    const jobCols12 = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
    if (!jobCols12.includes("board_key")) db.exec("ALTER TABLE jobs ADD COLUMN board_key TEXT");
    // 测试里手工搭的更老的 jobs 表可能连 apply_url/ats 都没有;真实库一定有。没有就只加列不回填。
    if (jobCols12.includes("apply_url") && jobCols12.includes("ats")) {
      const need12 = db.prepare("SELECT id, apply_url, ats FROM jobs WHERE board_key IS NULL AND apply_url IS NOT NULL").all() as { id: number; apply_url: string; ats: string | null }[];
      const upd12 = db.prepare("UPDATE jobs SET board_key = ?, ats = COALESCE(ats, ?) WHERE id = ?");
      db.transaction(() => {
        for (const r of need12) {
          const b = parseBoard(r.apply_url);
          upd12.run(b?.key ?? null, r.ats ?? atsFromUrl(r.apply_url), r.id);
        }
      })();
      discoverBoardsFromJobs(db);
      // 已经出过高分岗的板块直接成为 core,不用等第二天凌晨的重算。
      retierAll(db);
    }
  }
  // New DBs (found === 0) skip the migration block above but still need the index — it can't
  // live in schema.sql's CREATE INDEX IF NOT EXISTS because that runs via db.exec(readSchema())
  // before old DBs have gained the dedup_key column, so it's created here unconditionally instead.
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_dedup_key ON jobs(dedup_key)");
  // Same reasoning as idx_jobs_dedup_key above: created here so both old and new DBs get it.
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_duplicate_of ON jobs(duplicate_of)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_board_key ON jobs(board_key)");
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
