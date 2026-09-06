import { describe, it, expect, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, getDb, logEvent } from "@/lib/db";

describe("db", () => {
  it("creates all tables and inserts a job", () => {
    const db = openDb(":memory:");
    db.prepare(
      "INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)"
    ).run("fp1", "Stripe", "SWE New Grad", "greenhouse");
    const row = db.prepare("SELECT company FROM jobs WHERE fingerprint=?").get("fp1") as { company: string };
    expect(row.company).toBe("Stripe");
  });

  it("rejects duplicate fingerprints", () => {
    const db = openDb(":memory:");
    const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)");
    ins.run("fp1", "A", "T", "s");
    expect(() => ins.run("fp1", "B", "T2", "s")).toThrow();
  });

  it("logs events", () => {
    const db = openDb(":memory:");
    logEvent(db, "scan_done", { entity: "scanner", payload: { inserted: 3 } });
    const row = db.prepare("SELECT kind, payload FROM events").get() as { kind: string; payload: string };
    expect(row.kind).toBe("scan_done");
    expect(JSON.parse(row.payload).inserted).toBe(3);
  });

  it("registers all 9 spec tables in sqlite_master", () => {
    const db = openDb(":memory:");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name);
    for (const t of [
      "jobs",
      "matches",
      "applications",
      "people",
      "outreach",
      "companies",
      "resumes",
      "events",
      "profile",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("registers executor_runs (v4)", () => {
    const db = openDb(":memory:");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toContain("executor_runs");
  });

  it("sets user_version as a migration hook for future plans", () => {
    const db = openDb(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(11);
  });

  it("reads user_version before stamping it (read-then-stamp, not a blind unconditional write)", () => {
    const spy = vi.spyOn(Database.prototype, "pragma");
    try {
      openDb(":memory:");
      const calls = spy.mock.calls.map((c) => c[0]);
      const readIdx = calls.indexOf("user_version");
      const writeIdx = calls.findIndex((c) => typeof c === "string" && /^user_version\s*=\s*11$/.test(c));
      expect(readIdx).toBeGreaterThanOrEqual(0);
      expect(writeIdx).toBeGreaterThan(readIdx);
    } finally {
      spy.mockRestore();
    }
  });

  it("resolves schema.sql relative to the module, not the process cwd", () => {
    const originalCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobseeker-cwd-"));
    try {
      process.chdir(tmpDir);
      const db = openDb(":memory:");
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'")
        .get();
      expect(row).toBeTruthy();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("keeps applications.updated_at fresh via an AFTER UPDATE trigger", () => {
    const db = openDb(":memory:");
    const jobId = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
      .run("fp-trigger", "A", "T", "s").lastInsertRowid as number;
    db.prepare(
      "INSERT INTO applications (job_id, status, updated_at) VALUES (?,?,?)"
    ).run(jobId, "discovered", "2000-01-01 00:00:00");
    db.prepare("UPDATE applications SET status = 'matched' WHERE job_id = ?").run(jobId);
    const row = db
      .prepare("SELECT updated_at FROM applications WHERE job_id = ?")
      .get(jobId) as { updated_at: string };
    expect(row.updated_at).not.toBe("2000-01-01 00:00:00");
  });

  it("migrates a v7 db to v8: adds columns, backfills dedup_key and jd_status, creates index", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsdb-"));
    const file = path.join(dir, "v7.db");
    const raw = new Database(file);
    raw.exec(`CREATE TABLE jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fingerprint TEXT NOT NULL UNIQUE,
      company TEXT NOT NULL, title TEXT NOT NULL, location TEXT, jd_text TEXT, apply_url TEXT,
      source TEXT NOT NULL, ats TEXT, posted_at TEXT,
      job_kind TEXT NOT NULL DEFAULT 'newgrad', visa_flag TEXT, loc_flag TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    raw.prepare("INSERT INTO jobs (fingerprint, company, title, jd_text, source) VALUES (?,?,?,?,?)")
      .run("a", "Acme Inc", "SWE Intern", "", "github_list");
    raw.prepare("INSERT INTO jobs (fingerprint, company, title, jd_text, source) VALUES (?,?,?,?,?)")
      .run("b", "Acme", "SWE Intern", "Real JD text here", "greenhouse");
    raw.pragma("user_version = 7");
    raw.close();

    const db = openDb(file);
    const cols = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
    for (const c of ["dedup_key", "duplicate_of", "dedup_judged_at", "sponsorship", "degree_req", "role_kind", "elig_source", "jd_status"]) {
      expect(cols).toContain(c);
    }
    const rows = db.prepare("SELECT fingerprint, dedup_key, jd_status FROM jobs ORDER BY id").all() as any[];
    expect(rows[0]).toMatchObject({ fingerprint: "a", dedup_key: "acme|swe intern", jd_status: "missing" });
    expect(rows[1]).toMatchObject({ fingerprint: "b", dedup_key: "acme|swe intern", jd_status: null });
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_jobs_dedup_key'").get();
    expect(idx).toBeTruthy();
    const dupIdx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_jobs_duplicate_of'")
      .get();
    expect(dupIdx).toBeTruthy();
    expect(db.pragma("user_version", { simple: true })).toBe(11);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("getDb singleton", () => {
    afterEach(() => {
      delete (globalThis as { __jsdb?: unknown }).__jsdb;
    });

    it("reuses a db already hung on globalThis (HMR-safe singleton)", () => {
      const fakeDb = openDb(":memory:");
      (globalThis as { __jsdb?: unknown }).__jsdb = fakeDb;
      expect(getDb()).toBe(fakeDb);
    });
  });
});

describe("db v8 migration", () => {
  it("v9: adds referral columns and outreach_jobs, and migrates a v7 db idempotently", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jsdb-v8-")), "t.db");
    // Simulate a v7 database: hand-built tables without the v8 columns, user_version=7, so the
    // migration path (ALTER TABLE ADD COLUMN) is exercised; the second open must be a no-op.
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE jobs (id INTEGER PRIMARY KEY, fingerprint TEXT UNIQUE, company TEXT, title TEXT, jd_text TEXT, source TEXT, created_at TEXT);
      CREATE TABLE matches (id INTEGER PRIMARY KEY, job_id INTEGER UNIQUE, direction TEXT, score INTEGER, tier INTEGER, resume_id INTEGER, reason TEXT, skip_reason TEXT, created_at TEXT);
      CREATE TABLE applications (id INTEGER PRIMARY KEY, job_id INTEGER UNIQUE, status TEXT NOT NULL DEFAULT 'discovered', submitted_at TEXT, resume_id INTEGER, form_screenshot TEXT, confirm_screenshot TEXT, referral_person_id INTEGER, origin_outreach_id INTEGER, answer_pack TEXT, filled_fields TEXT, confirm_decision TEXT, needs_manual_reason TEXT, pinned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE executor_runs (id INTEGER PRIMARY KEY, kind TEXT, status TEXT, channel TEXT, pid INTEGER, log_path TEXT, options TEXT, summary TEXT, started_at TEXT, claimed_at TEXT, ended_at TEXT);
      PRAGMA user_version = 7;
    `);
    raw.close();

    for (let i = 0; i < 2; i++) {
      const db = openDb(file);
      const mCols = (db.prepare("PRAGMA table_info(matches)").all() as { name: string }[]).map((c) => c.name);
      expect(mCols).toContain("referral_fit");
      expect(mCols).toContain("referral_reason");
      const aCols = (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map((c) => c.name);
      expect(aCols).toContain("apply_mode");
      expect(aCols).toContain("referral_info");
      expect(aCols).toContain("referral_reached_at");
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
      expect(tables).toContain("outreach_jobs");
      expect(db.pragma("user_version", { simple: true })).toBe(11);
      db.close();
    }
  });
});
