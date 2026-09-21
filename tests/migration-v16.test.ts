import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, tableDdl } from "@/lib/db";
import { LEGACY_USER_ID } from "@/lib/users";

// A v14-shaped db: the single-user tables exactly as schema.sql had them before accounts (UNIQUE
// on job_id / linkedin_url / version_name, no user_id anywhere), with a little data and the
// cross-table references the rebuild must preserve.
function makeV14(file: string) {
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL UNIQUE, company TEXT NOT NULL, title TEXT NOT NULL,
      location TEXT, jd_text TEXT, apply_url TEXT, source TEXT NOT NULL, ats TEXT, posted_at TEXT, job_kind TEXT NOT NULL DEFAULT 'newgrad',
      visa_flag TEXT, loc_flag TEXT, dedup_key TEXT, duplicate_of INTEGER REFERENCES jobs(id), dedup_judged_at TEXT, sponsorship TEXT,
      degree_req TEXT, role_kind TEXT, elig_source TEXT, jd_status TEXT, board_key TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE resumes (id INTEGER PRIMARY KEY AUTOINCREMENT, version_name TEXT NOT NULL UNIQUE, directions TEXT NOT NULL DEFAULT '[]',
      tex_path TEXT, pdf_path TEXT, compiled_at TEXT);
    CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company TEXT, role_title TEXT, linkedin_url TEXT UNIQUE,
      email TEXT, email_status TEXT, relation TEXT, source TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE outreach (id INTEGER PRIMARY KEY AUTOINCREMENT, person_id INTEGER NOT NULL REFERENCES people(id), job_id INTEGER REFERENCES jobs(id),
      playbook TEXT NOT NULL, channel TEXT NOT NULL, draft TEXT, draft_note TEXT, referral_stage TEXT, stage_summary TEXT, stage_action TEXT,
      stage_link TEXT, last_checked_at TEXT, thread_log TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', outcome TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE matches (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id), direction TEXT, score INTEGER,
      tier INTEGER, resume_id INTEGER REFERENCES resumes(id), reason TEXT, skip_reason TEXT, referral_fit INTEGER, referral_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
      status TEXT NOT NULL DEFAULT 'discovered', submitted_at TEXT, resume_id INTEGER REFERENCES resumes(id), form_screenshot TEXT,
      confirm_screenshot TEXT, referral_person_id INTEGER REFERENCES people(id), origin_outreach_id INTEGER REFERENCES outreach(id),
      answer_pack TEXT, filled_fields TEXT, confirm_decision TEXT, needs_manual_reason TEXT, pinned INTEGER NOT NULL DEFAULT 0,
      pending_questions TEXT, info_answers TEXT, apply_mode TEXT, referral_info TEXT, referral_reached_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE outreach_jobs (outreach_id INTEGER NOT NULL REFERENCES outreach(id), job_id INTEGER NOT NULL REFERENCES jobs(id), PRIMARY KEY (outreach_id, job_id));
    CREATE TABLE experiences (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, title TEXT NOT NULL, organization TEXT, location TEXT,
      start_date TEXT, end_date TEXT, bullets TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE executor_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
      channel TEXT NOT NULL DEFAULT 'headless', pid INTEGER, log_path TEXT, options TEXT NOT NULL DEFAULT '{}', summary TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')), claimed_at TEXT, ended_at TEXT);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, entity TEXT, entity_id INTEGER, payload TEXT NOT NULL DEFAULT '{}',
      at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE profile (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE boards (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, family TEXT NOT NULL, ident TEXT NOT NULL, company TEXT,
      origin TEXT NOT NULL, tier TEXT NOT NULL DEFAULT 'longtail', tier_reason TEXT, tier_locked INTEGER NOT NULL DEFAULT 0, directions TEXT, meta TEXT,
      next_due_at TEXT, last_polled_at TEXT, last_ok_at TEXT, last_error TEXT, fail_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TRIGGER trg_applications_updated AFTER UPDATE ON applications BEGIN UPDATE applications SET updated_at = datetime('now') WHERE id = NEW.id; END;
  `);
  const j1 = raw.prepare("INSERT INTO jobs (fingerprint, company, title, source, dedup_key, board_key) VALUES (?,?,?,?,?,?)").run("f1", "Stripe", "SWE", "greenhouse", "stripe|swe", "greenhouse:stripe").lastInsertRowid;
  const j2 = raw.prepare("INSERT INTO jobs (fingerprint, company, title, source, dedup_key, board_key) VALUES (?,?,?,?,?,?)").run("f2", "Datadog", "SWE Intern", "greenhouse", "datadog|swe intern", "greenhouse:datadog").lastInsertRowid;
  const r1 = raw.prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)").run("swe_general_v1", '["swe_general"]', "/x/swe.pdf", "2026-09-01 00:00:00").lastInsertRowid;
  const p1 = raw.prepare("INSERT INTO people (name, company, linkedin_url, relation) VALUES (?,?,?,?)").run("Jane", "Stripe", "in/jane", "alum").lastInsertRowid;
  const o1 = raw.prepare("INSERT INTO outreach (person_id, job_id, playbook, channel, draft, status) VALUES (?,?,?,?,?,?)").run(p1, j1, "referral", "linkedin", "hi", "sent").lastInsertRowid;
  raw.prepare("INSERT INTO outreach_jobs (outreach_id, job_id) VALUES (?,?)").run(o1, j1);
  raw.prepare("INSERT INTO matches (job_id, direction, score, tier, resume_id, referral_fit) VALUES (?,?,?,?,?,?)").run(j1, "swe_general", 88, 1, r1, 1);
  raw.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(j2, "swe_general", 70, 1);
  raw.prepare("INSERT INTO applications (job_id, status, resume_id, referral_person_id, origin_outreach_id, pinned, submitted_at, updated_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(j1, "submitted", r1, p1, o1, 1, "2026-09-02 10:00:00", "2000-01-01 00:00:00");
  raw.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(j2, "matched");
  raw.prepare("INSERT INTO experiences (kind, title, bullets) VALUES (?,?,?)").run("work", "Intern", "[]");
  raw.prepare("INSERT INTO executor_runs (kind, status, channel) VALUES (?,?,?)").run("apply", "done", "user_chrome");
  raw.prepare("INSERT INTO events (kind, entity, entity_id) VALUES (?,?,?)").run("application_stage", "application", j1);
  raw.pragma("user_version = 14");
  raw.close();
}

describe("v14 → v16 migration (accounts; main's v15 run_id/outcome step runs first)", () => {
  it("rebuilds the four unique-constrained tables, adds user_id everywhere, keeps rows, ids, references and the trigger", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "v16-")), "db.sqlite");
    makeV14(file);
    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(17);

    for (const t of ["matches", "applications", "people", "outreach", "resumes", "experiences", "executor_runs", "events"]) {
      const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      expect(cols, t).toContain("user_id");
    }
    // Every pre-accounts row landed in the legacy bucket, ids intact.
    for (const t of ["matches", "applications", "people", "outreach", "resumes", "experiences", "executor_runs"]) {
      const rows = db.prepare(`SELECT id, user_id FROM ${t} ORDER BY id`).all() as { id: number; user_id: string }[];
      expect(rows.length, t).toBeGreaterThan(0);
      expect(rows.every((r) => r.user_id === LEGACY_USER_ID), t).toBe(true);
    }
    expect((db.prepare("SELECT user_id FROM events").get() as { user_id: string | null }).user_id).toBeNull();

    // References survived the copy.
    const app = db.prepare("SELECT job_id, status, resume_id, referral_person_id, origin_outreach_id, pinned, submitted_at FROM applications WHERE id = 1").get();
    expect(app).toEqual({ job_id: 1, status: "submitted", resume_id: 1, referral_person_id: 1, origin_outreach_id: 1, pinned: 1, submitted_at: "2026-09-02 10:00:00" });
    expect(db.prepare("SELECT score, resume_id, referral_fit FROM matches WHERE job_id = 1").get()).toEqual({ score: 88, resume_id: 1, referral_fit: 1 });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);

    // The new constraints: the same job may now have one row per user, but still only one per user.
    db.prepare("INSERT INTO applications (user_id, job_id, status) VALUES (?,?,?)").run("u2", 1, "matched");
    expect(() => db.prepare("INSERT INTO applications (user_id, job_id) VALUES (?,?)").run("u2", 1)).toThrow(/UNIQUE/);
    db.prepare("INSERT INTO matches (user_id, job_id, score) VALUES (?,?,?)").run("u2", 1, 50);
    db.prepare("INSERT INTO people (user_id, name, linkedin_url) VALUES (?,?,?)").run("u2", "Jane again", "in/jane");
    expect(() => db.prepare("INSERT INTO people (user_id, name, linkedin_url) VALUES (?,?,?)").run("u2", "Jane twice", "in/jane")).toThrow(/UNIQUE/);
    db.prepare("INSERT INTO resumes (user_id, version_name) VALUES (?,?)").run("u2", "swe_general_v1");

    // The updated_at trigger came back with the rebuilt table.
    db.prepare("UPDATE applications SET status = 'oa' WHERE id = 1").run();
    expect((db.prepare("SELECT updated_at FROM applications WHERE id = 1").get() as { updated_at: string }).updated_at).not.toBe("2000-01-01 00:00:00");

    // Indexes on user_id exist; the auth + profiles + api_tokens tables exist.
    const names = (db.prepare("SELECT name FROM sqlite_master").all() as { name: string }[]).map((r) => r.name);
    for (const n of ["idx_applications_user_status", "idx_people_user", "idx_outreach_user_status", "idx_runs_user_status", "user", "session", "account", "verification", "profiles", "api_tokens", "trg_applications_updated"]) {
      expect(names).toContain(n);
    }
    db.close();

    // Re-open: no-op.
    const again = openDb(file);
    expect((again.prepare("SELECT COUNT(*) n FROM applications").get() as { n: number }).n).toBe(3);
    expect(again.pragma("user_version", { simple: true })).toBe(17);
    again.close();
  });

  it("tableDdl cuts exactly one table's statement out of schema.sql", () => {
    const schema = fs.readFileSync(path.join(process.cwd(), "src/lib/schema.sql"), "utf8");
    const ddl = tableDdl(schema, "resumes");
    expect(ddl.startsWith("CREATE TABLE IF NOT EXISTS resumes (")).toBe(true);
    expect(ddl.endsWith("\n);")).toBe(true);
    expect(ddl).toContain("UNIQUE (user_id, version_name)");
    expect(ddl).not.toContain("CREATE TABLE IF NOT EXISTS events");
    expect(() => tableDdl(schema, "nope")).toThrow(/no CREATE TABLE/);
  });
});
