import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { EFFECTIVE_MODE_SQL, setApplyMode, effectiveMode } from "@/apply/mode";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

function seed(db: DB, opts: { referralFit?: number | null; applyMode?: string | null; status?: string } = {}): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
    .run(`fp-${Math.random()}`, "Acme", "SWE", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier, referral_fit) VALUES (?,?,?,?,?)").run(
    jobId,
    "swe_general",
    80,
    1,
    opts.referralFit ?? null
  );
  db.prepare("INSERT INTO applications (job_id, status, apply_mode) VALUES (?,?,?)").run(
    jobId,
    opts.status ?? "matched",
    opts.applyMode ?? null
  );
  return jobId;
}

describe("apply/mode", () => {
  it("effective mode: override beats suggestion, suggestion beats default 'direct'", () => {
    const db = openDb(":memory:");
    expect(effectiveMode(db, U, seed(db))).toBe("direct"); // unclassified
    expect(effectiveMode(db, U, seed(db, { referralFit: 0 }))).toBe("direct");
    expect(effectiveMode(db, U, seed(db, { referralFit: 1 }))).toBe("referral");
    expect(effectiveMode(db, U, seed(db, { referralFit: 1, applyMode: "direct" }))).toBe("direct");
    expect(effectiveMode(db, U, seed(db, { referralFit: 0, applyMode: "referral" }))).toBe("referral");
  });

  it("EFFECTIVE_MODE_SQL is usable inline in a query over applications a JOIN matches m", () => {
    const db = openDb(":memory:");
    const id = seed(db, { referralFit: 1 });
    const row = db
      .prepare(
        `SELECT ${EFFECTIVE_MODE_SQL} AS mode FROM applications a JOIN matches m ON m.job_id = a.job_id WHERE a.job_id = ?`
      )
      .get(id) as { mode: string };
    expect(row.mode).toBe("referral");
  });

  it("setApplyMode writes/clears the override only while status='matched'", () => {
    const db = openDb(":memory:");
    const id = seed(db, { referralFit: 1 });
    setApplyMode(db, U, id, "direct");
    expect(effectiveMode(db, U, id)).toBe("direct");
    setApplyMode(db, U, id, null);
    expect(effectiveMode(db, U, id)).toBe("referral");
    const seeking = seed(db, { status: "referral_seeking" });
    expect(() => setApplyMode(db, U, seeking, "direct")).toThrow(/must be 'matched'/);
    expect(() => setApplyMode(db, U, id, "bogus" as never)).toThrow(/invalid mode/);
  });
});
