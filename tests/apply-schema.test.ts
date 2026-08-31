import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb } from "@/lib/db";

describe("apply executor schema (v3)", () => {
  it("a fresh :memory: db has all four v3 applications columns and user_version 3", () => {
    const db = openDb(":memory:");
    const cols = (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map(
      (c) => c.name
    );
    for (const col of ["answer_pack", "filled_fields", "confirm_decision", "needs_manual_reason"]) {
      expect(cols).toContain(col);
    }
    expect(db.pragma("user_version", { simple: true })).toBe(3);
  });

  it("inserts and reads back the new columns", () => {
    const db = openDb(":memory:");
    const jobId = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
      .run("fp-apply-schema", "A", "T", "s").lastInsertRowid as number;
    db.prepare(
      `INSERT INTO applications (job_id, status, answer_pack, filled_fields, confirm_decision, needs_manual_reason)
       VALUES (?,?,?,?,?,?)`
    ).run(jobId, "awaiting_confirm", JSON.stringify({ contact: {} }), JSON.stringify({ email: "a@b.c" }), "approved", null);
    const row = db.prepare("SELECT * FROM applications WHERE job_id=?").get(jobId) as Record<string, unknown>;
    expect(JSON.parse(row.answer_pack as string).contact).toEqual({});
    expect(JSON.parse(row.filled_fields as string).email).toBe("a@b.c");
    expect(row.confirm_decision).toBe("approved");
    expect(row.needs_manual_reason).toBeNull();
  });

  describe("v2 -> v3 migration on an existing on-disk db", () => {
    let tmpFile: string;

    afterEach(() => {
      if (tmpFile && fs.existsSync(tmpFile)) fs.rmSync(tmpFile, { force: true });
      for (const suffix of ["-wal", "-shm"]) {
        const p = tmpFile + suffix;
        if (fs.existsSync(p)) fs.rmSync(p, { force: true });
      }
    });

    it("adds the four missing columns to a v2-shaped applications table", () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jobseeker-migration-"));
      tmpFile = path.join(tmpDir, "v2.db");

      // Hand-build a v2-shaped db: applications table WITHOUT the new columns, user_version=2.
      const raw = new Database(tmpFile);
      raw.exec(`
        CREATE TABLE jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          fingerprint TEXT NOT NULL UNIQUE,
          company TEXT NOT NULL,
          title TEXT NOT NULL,
          source TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE applications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
          status TEXT NOT NULL DEFAULT 'discovered',
          submitted_at TEXT,
          resume_id INTEGER,
          form_screenshot TEXT,
          confirm_screenshot TEXT,
          referral_person_id INTEGER,
          origin_outreach_id INTEGER,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      raw.pragma("user_version = 2");
      const jobId = raw
        .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
        .run("fp-old", "OldCo", "Old Title", "manual").lastInsertRowid as number;
      raw.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(jobId, "matched");
      raw.close();

      const colsBefore = (
        new Database(tmpFile).prepare("PRAGMA table_info(applications)").all() as { name: string }[]
      ).map((c) => c.name);
      expect(colsBefore).not.toContain("answer_pack");

      // Opening it through openDb() should run the v2->v3 migration in place.
      const db = openDb(tmpFile);
      const cols = (db.prepare("PRAGMA table_info(applications)").all() as { name: string }[]).map(
        (c) => c.name
      );
      for (const col of ["answer_pack", "filled_fields", "confirm_decision", "needs_manual_reason"]) {
        expect(cols).toContain(col);
      }
      expect(db.pragma("user_version", { simple: true })).toBe(3);

      // Pre-existing data survives the migration.
      const row = db.prepare("SELECT status FROM applications WHERE job_id=?").get(jobId) as {
        status: string;
      };
      expect(row.status).toBe("matched");
      db.close();

      // Idempotent: opening the now-v3 db again must not throw (columns already present).
      const db2 = openDb(tmpFile);
      expect(db2.pragma("user_version", { simple: true })).toBe(3);
      db2.close();
    });
  });
});
