import { describe, it, expect } from "vitest";
import { openDb, logEvent } from "@/lib/db";

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
});
