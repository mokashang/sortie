import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { reportFill } from "@/apply/queue";
import { seedOwner, seedUser } from "./helpers";

// Postings are shared by every account; another account's assistant report may only move that
// account's own row (security review 2026-10-22).
function setup() {
  const db = openDb(":memory:");
  seedOwner(db, "legacy");
  seedUser(db, "m1", "m1@example.com", { role: "member" });
  db.prepare("INSERT INTO boards (key, family, ident, company, origin, tier) VALUES ('greenhouse:acme', 'greenhouse', 'acme', 'Acme', 'seed', 'core')").run();
  const jobId = Number(
    db
      .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, board_key) VALUES ('fp1', 'Acme', 'SWE', 'https://acme.example/1', 'greenhouse', 'manual', 'greenhouse:acme')")
      .run().lastInsertRowid
  );
  db.prepare("INSERT INTO applications (user_id, job_id, status, pinned) VALUES ('legacy', ?, 'matched', 1)").run(jobId);
  db.prepare("INSERT INTO applications (user_id, job_id, status) VALUES ('m1', ?, 'prepared')").run(jobId);
  const app = (u: string) => db.prepare("SELECT status FROM applications WHERE user_id = ? AND job_id = ?").get(u, jobId) as { status: string };
  const job = () => db.prepare("SELECT jd_status, sponsorship FROM jobs WHERE id = ?").get(jobId) as { jd_status: string | null; sponsorship: string | null };
  const board = () => (db.prepare("SELECT tier FROM boards WHERE key = 'greenhouse:acme'").get() as { tier: string }).tier;
  return { db, jobId, app, job, board };
}

describe("another account's assistant reports", () => {
  it("an eligibility verdict archives only that account's row and leaves the posting's facts alone", () => {
    const { db, jobId, app, job } = setup();
    reportFill(
      db,
      "m1",
      { jobId, status: "needs_manual", reason: "says no sponsorship", eligibility: { sponsorship: "no", degree: "ms_ok", role: "eng", evidence: "no sponsorship" } },
      { shared: false }
    );
    expect(app("m1").status).toBe("archived");
    expect(app("legacy").status).toBe("matched");
    expect(job().sponsorship).toBeNull();
  });
  it("a closed page with boardGone archives only that account's row: the posting stays open and the board keeps being scanned", () => {
    const { db, jobId, app, job, board } = setup();
    reportFill(db, "m1", { jobId, status: "closed", reason: "404", boardGone: true }, { shared: false });
    expect(app("m1").status).toBe("archived");
    expect(app("legacy").status).toBe("matched");
    expect(job().jd_status).not.toBe("closed");
    expect(board()).toBe("core");
  });
  it("the owner's report still closes the posting and mutes a vanished board", () => {
    const { db, jobId, job, board } = setup();
    db.prepare("UPDATE applications SET status = 'prepared' WHERE user_id = 'legacy'").run();
    reportFill(db, "legacy", { jobId, status: "closed", reason: "404", boardGone: true });
    expect(job().jd_status).toBe("closed");
    expect(board()).toBe("muted");
  });
});
