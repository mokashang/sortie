import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, migrateV19, tableDdl } from "@/lib/db";

const schema = fs.readFileSync(path.join(__dirname, "../src/lib/schema.sql"), "utf8");

// A v18-shaped db: today's schema.sql with jd_text back in the jobs row and no job_texts table.
function v18Schema(): string {
  const jobs = tableDdl(schema, "jobs");
  const oldJobs = jobs.replace("  location TEXT,\n", "  location TEXT,\n  jd_text TEXT,\n");
  if (oldJobs === jobs) throw new Error("jobs DDL no longer has the line the v18 shape is rebuilt from");
  return schema.replace(jobs, oldJobs).replace(tableDdl(schema, "job_texts"), "");
}

// Ids straddle the 5000-id batches, and one text is far longer than a page so it lives in overflow pages.
const TEXTS: [number, string | null][] = [
  [1, "Build compilers. We sponsor visas."],
  [2, ""],
  [3, "[listing metadata] sponsorship: unknown"],
  [4, null],
  [4999, "x".repeat(50_000)],
  [5000, "edge of the first batch"],
  [5001, "first of the second batch — 中文也要原样搬过去"],
  [12345, "a later batch"],
];

function makeV18(file: string) {
  const raw = new Database(file);
  raw.exec(v18Schema());
  const ins = raw.prepare("INSERT INTO jobs (id, fingerprint, company, title, jd_text, source, visa_flag) VALUES (?,?,?,?,?,?,?)");
  for (const [id, text] of TEXTS) ins.run(id, `fp-${id}`, "Acme", `Job ${id}`, text, "greenhouse", id === 3 ? "no_sponsor" : null);
  raw.prepare("INSERT INTO applications (user_id, job_id, status) VALUES ('legacy', 5001, 'matched')").run();
  raw.prepare("INSERT INTO matches (user_id, job_id, score) VALUES ('legacy', 5001, 81)").run();
  // The newest job was deleted at some point: ids must not be handed out again.
  raw.prepare("UPDATE sqlite_sequence SET seq = 19999 WHERE name = 'jobs'").run();
  raw.pragma("user_version = 18");
  raw.close();
}

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jsdb-v19-")), "t.db");

describe("v19 migration: jobs.jd_text → job_texts", () => {
  it("moves every text out of the jobs row unchanged, drops the column, and is a no-op on reopen", () => {
    const file = tmpFile();
    makeV18(file);

    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(19);
    const cols = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("jd_text");
    expect(cols).toContain("visa_flag");

    const rows = db.prepare("SELECT j.id, t.jd_text FROM jobs j LEFT JOIN job_texts t ON t.job_id = j.id ORDER BY j.id").all() as { id: number; jd_text: string | null }[];
    expect(rows.map((r) => [r.id, r.jd_text])).toEqual(TEXTS);
    // NULL stays "no row"; the empty string stays an empty string.
    expect((db.prepare("SELECT COUNT(*) n FROM job_texts").get() as { n: number }).n).toBe(TEXTS.filter(([, t]) => t !== null).length);
    expect(db.prepare("SELECT visa_flag FROM jobs WHERE id = 3").get()).toEqual({ visa_flag: "no_sponsor" });
    expect(db.prepare("SELECT a.status, m.score FROM applications a JOIN matches m ON m.job_id = a.job_id WHERE a.job_id = 5001").get()).toEqual({ status: "matched", score: 81 });

    // The rebuilt table is the real jobs table again: references resolve, indexes are back, ids keep counting.
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(() => db.prepare("INSERT INTO applications (user_id, job_id) VALUES ('legacy', 99999)").run()).toThrow(/FOREIGN KEY/);
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'jobs'").all() as { name: string }[]).map((r) => r.name);
    for (const ix of ["idx_jobs_created", "idx_jobs_dedup_key", "idx_jobs_duplicate_of", "idx_jobs_board_key", "idx_jobs_apply_url"]) expect(indexes).toContain(ix);
    expect(() => db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES ('fp-1', 'X', 'Y', 'manual')").run()).toThrow(/UNIQUE/);
    expect(Number(db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES ('fp-new', 'X', 'Y', 'manual')").run().lastInsertRowid)).toBe(20000);
    db.close();

    const again = openDb(file);
    expect(again.pragma("user_version", { simple: true })).toBe(19);
    expect(migrateV19(again, schema)).toBeNull();
    expect((again.prepare("SELECT COUNT(*) n FROM job_texts").get() as { n: number }).n).toBe(TEXTS.filter(([, t]) => t !== null).length);
    again.close();
  });

  it("rolls the whole move back when a batch does not copy cleanly", () => {
    const file = tmpFile();
    makeV18(file);
    const raw = new Database(file);
    raw.exec(tableDdl(schema, "job_texts"));
    // A stray row in the second batch makes that batch's copy fail after the first batch was moved.
    raw.prepare("INSERT INTO job_texts (job_id, jd_text) VALUES (5001, 'stray')").run();
    expect(() => migrateV19(raw, schema)).toThrow();
    const cols = (raw.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("jd_text");
    const kept = raw.prepare("SELECT id, jd_text FROM jobs ORDER BY id").all() as { id: number; jd_text: string | null }[];
    expect(kept.map((r) => [r.id, r.jd_text])).toEqual(TEXTS);
    expect(raw.prepare("SELECT job_id, jd_text FROM job_texts").all()).toEqual([{ job_id: 5001, jd_text: "stray" }]);
    raw.close();
  });

  it("a fresh db is born in the new shape", () => {
    const db = openDb(":memory:");
    const cols = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("jd_text");
    expect(migrateV19(db, schema)).toBeNull();
  });
});
