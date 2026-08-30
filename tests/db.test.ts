import { describe, it, expect, afterEach } from "vitest";
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

  it("sets user_version as a migration hook for future plans", () => {
    const db = openDb(":memory:");
    expect(db.pragma("user_version", { simple: true })).toBe(1);
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
