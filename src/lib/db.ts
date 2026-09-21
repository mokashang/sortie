import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { dataDir } from "@/lib/paths";
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

// v17 (2026-09-21): mail_accounts + mail_events (邮箱同步, spec 2026-09-21 inbox-sync). Both are
// brand-new tables, so schema.sql's CREATE TABLE IF NOT EXISTS covers old and new dbs alike — no
// migration step beyond the version bump.
const SCHEMA_VERSION = 17;

function columnsOf(db: DB, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

// Cuts one table's CREATE TABLE statement out of schema.sql (each table ends with a `);` line —
// the convention the file's header documents) so the rebuild migration never duplicates DDL.
export function tableDdl(schema: string, table: string): string {
  const re = new RegExp(`CREATE TABLE IF NOT EXISTS "?${table}"? \\([\\s\\S]*?\\n\\);`);
  const m = schema.match(re);
  if (!m) throw new Error(`schema.sql has no CREATE TABLE for ${table}`);
  return m[0];
}

// v15 -> v16: accounts (spec 2026-09-13 accounts §3). Every per-user table gains
// user_id TEXT NOT NULL DEFAULT 'legacy' — the bucket holding everything written before accounts
// existed, which the first account claims (src/lib/users.ts). The four tables whose UNIQUE
// constraint changes (job_id → (user_id, job_id), linkedin_url → (user_id, linkedin_url),
// version_name → (user_id, version_name)) are rebuilt the way the sqlite docs prescribe: create
// the new shape under a temporary name, copy the common columns, drop the old table, rename —
// with foreign keys off so the drop performs no implicit deletes. The others just get the column.
// Re-runnable: a table that already has user_id is left alone.
const V16_REBUILD = ["matches", "applications", "people", "resumes"] as const;
const V16_ADD_COLUMN = ["outreach", "experiences", "executor_runs"] as const;
export function migrateV16(db: DB, schema: string): { rebuilt: string[] } {
  const rebuilt = V16_REBUILD.filter((t) => !columnsOf(db, t).includes("user_id"));
  if (rebuilt.length > 0) {
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        for (const t of rebuilt) {
          const tmp = `${t}__v16`;
          db.exec(tableDdl(schema, t).replace(/CREATE TABLE IF NOT EXISTS "?\w+"? \(/, `CREATE TABLE ${tmp} (`));
          const newCols = columnsOf(db, tmp);
          const common = columnsOf(db, t).filter((c) => newCols.includes(c)).join(", ");
          db.exec(`INSERT INTO ${tmp} (${common}) SELECT ${common} FROM ${t}`);
          db.exec(`DROP TABLE ${t}`);
          db.exec(`ALTER TABLE ${tmp} RENAME TO ${t}`);
        }
      })();
      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) console.warn(`[db] v16 rebuild: ${violations.length} foreign key violation(s) remain (pre-existing dangling references)`);
    } finally {
      db.pragma("foreign_keys = ON");
    }
    // Dropping a table drops its trigger and indexes; the schema recreates them (IF NOT EXISTS).
    db.exec(schema);
  }
  for (const t of V16_ADD_COLUMN) {
    if (!columnsOf(db, t).includes("user_id")) db.exec(`ALTER TABLE ${t} ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy'`);
  }
  if (!columnsOf(db, "events").includes("user_id")) db.exec("ALTER TABLE events ADD COLUMN user_id TEXT");
  return { rebuilt: [...rebuilt] };
}

export function openDb(file?: string): DB {
  const dbFile = file ?? path.join(dataDir(), "jobseeker.db");
  if (dbFile !== ":memory:") fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Migration hook: read the schema version actually on disk before touching it, so future
  // plans can branch on `found` to run incremental migrations instead of blindly overwriting.
  const found = db.pragma("user_version", { simple: true }) as number;
  const schema = readSchema();
  db.exec(schema);
  if (found > 0 && found < SCHEMA_VERSION) {
    // v16's events.user_id goes first: the v12 step below calls retierAll(), which logs an event
    // through logEvent() — and that INSERT names the column.
    if (!columnsOf(db, "events").includes("user_id")) db.exec("ALTER TABLE events ADD COLUMN user_id TEXT");
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
    // v13 -> v14: people gained notes — what the attended session read on the person's profile
    // (headline / About / a recent post), the draft engine's only source for the "line about
    // them" (src/network/draft.ts, 2026-09-11 outreach wording rework: give before you ask).
    const peopleCols14 = (db.prepare("PRAGMA table_info(people)").all() as { name: string }[]).map((c) => c.name);
    if (!peopleCols14.includes("notes")) db.exec("ALTER TABLE people ADD COLUMN notes TEXT");
    // v14 -> v15: applications.run_id (which apply run claimed the row) + executor_runs.outcome (the
    // run's planned-vs-achieved snapshot, src/apply/run-outcome.ts) — so a task that filled 5 of a
    // planned 70 shows 未完成 · 海投 5/70 instead of 已完成 (2026-09-13, task #68).
    const appCols15 = (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map((c) => c.name);
    if (!appCols15.includes("run_id")) db.exec("ALTER TABLE applications ADD COLUMN run_id INTEGER");
    const runCols15 = (db.prepare("PRAGMA table_info(executor_runs)").all() as { name: string }[]).map((c) => c.name);
    if (!runCols15.includes("outcome")) db.exec("ALTER TABLE executor_runs ADD COLUMN outcome TEXT");
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
    // v15 -> v16: accounts. Must stay last — the rebuild copies whatever columns the steps above
    // have already added. See migrateV16.
    migrateV16(db, schema);
  }
  // Tenant indexes (schema v16). Created here rather than in schema.sql for the same reason as
  // the job indexes below: schema.sql runs before an old db has gained user_id.
  db.exec("CREATE INDEX IF NOT EXISTS idx_applications_user_status ON applications(user_id, status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_matches_job ON matches(job_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_people_user ON people(user_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_outreach_user_status ON outreach(user_id, status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_runs_user_status ON executor_runs(user_id, status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_experiences_user ON experiences(user_id, kind, sort_order)");
  // New DBs (found === 0) skip the migration block above but still need the index — it can't
  // live in schema.sql's CREATE INDEX IF NOT EXISTS because that runs via db.exec(readSchema())
  // before old DBs have gained the dedup_key column, so it's created here unconditionally instead.
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_dedup_key ON jobs(dedup_key)");
  // Same reasoning as idx_jobs_dedup_key above: created here so both old and new DBs get it.
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_duplicate_of ON jobs(duplicate_of)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_board_key ON jobs(board_key)");
  // The scanner asks `SELECT 1 FROM jobs WHERE apply_url = ?` once per discovered posting (scheduler.ts,
  // ingest.ts). Without this index that is a full table scan — ~300 ms each on the 78k-row / 434 MB
  // production db — so a minute's tick ran for many minutes, stayed "in flight" and pinned the server's
  // single thread at 100% (2026-09-11, first day on the Windows box). Created here rather than in
  // schema.sql for the same reason as the indexes above: the migration tests build old-shaped dbs
  // whose jobs table has no apply_url column yet when readSchema() runs.
  // Guarded because the migration tests open hand-built old-shaped dbs whose jobs table has no
  // apply_url column at all; every real database has had the column since v1.
  const jobColsForIndex = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
  if (jobColsForIndex.includes("apply_url")) db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_apply_url ON jobs(apply_url)");
  db.pragma(`user_version = ${SCHEMA_VERSION}`);

  return db;
}

// Hang the singleton on globalThis (rather than a module-scoped variable) so it survives
// Next dev's Fast Refresh / HMR module re-evaluation instead of silently reopening the db.
const globalForDb = globalThis as unknown as { __jsdb?: DB };
export function getDb(): DB {
  return (globalForDb.__jsdb ??= openDb());
}

// `userId` scopes an event to one account (application stage moves, info answers, referral
// decisions); machine-wide events (scan ticks, retiers, job eligibility) leave it NULL.
export function logEvent(
  db: DB,
  kind: string,
  opts: { entity?: string; entityId?: number; payload?: unknown; userId?: string | null } = {}
): void {
  db.prepare("INSERT INTO events (user_id, kind, entity, entity_id, payload) VALUES (?,?,?,?,?)").run(
    opts.userId ?? null,
    kind,
    opts.entity ?? null,
    opts.entityId ?? null,
    JSON.stringify(opts.payload ?? {})
  );
}
