import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb } from "@/lib/db";

// 造一个 v11 形状的旧库:jobs 没有 board_key,user_version=11。
function makeV11(file: string) {
  const raw = new Database(file);
  raw.exec(`CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL UNIQUE, company TEXT NOT NULL, title TEXT NOT NULL,
    location TEXT, jd_text TEXT, apply_url TEXT, source TEXT NOT NULL, ats TEXT, posted_at TEXT, job_kind TEXT NOT NULL DEFAULT 'newgrad', visa_flag TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), loc_flag TEXT, dedup_key TEXT, duplicate_of INTEGER, dedup_judged_at TEXT, sponsorship TEXT,
    degree_req TEXT, role_kind TEXT, elig_source TEXT, jd_status TEXT)`);
  const ins = raw.prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source, ats, dedup_key) VALUES (?,?,?,?,?,?,?)");
  ins.run("f1", "NVIDIA", "GPU Eng New Grad", "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/x_JR1", "github_list", null, "nvidia|gpu eng new grad");
  ins.run("f2", "Stripe", "SWE New Grad", "https://stripe.com/jobs/search?gh_jid=8128744", "github_list", null, "stripe|swe new grad");
  raw.pragma("user_version = 11");
  raw.close();
}

describe("v11 → v12 migration", () => {
  it("adds boards + jobs.board_key, backfills board_key/ats, discovers boards from URLs, is re-runnable", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "v12-")), "db.sqlite");
    makeV11(file);
    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(14);
    const rows = db.prepare("SELECT title, board_key, ats FROM jobs ORDER BY id").all();
    expect(rows[0]).toEqual({ title: "GPU Eng New Grad", board_key: "workday:nvidia.wd5/NVIDIAExternalCareerSite", ats: "workday" });
    expect(rows[1]).toEqual({ title: "SWE New Grad", board_key: null, ats: "greenhouse" });
    expect(db.prepare("SELECT origin, tier, company FROM boards WHERE key = ?").get("workday:nvidia.wd5/NVIDIAExternalCareerSite")).toMatchObject({ origin: "url", company: "NVIDIA" });
    db.close();
    const again = openDb(file);
    expect((again.prepare("SELECT COUNT(*) n FROM boards").get() as { n: number }).n).toBeGreaterThan(0);
    again.close();
  });
});
