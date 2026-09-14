import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { maybeStartJdReview, jdReviewRunsToday, JD_REVIEW_DAILY_CAP } from "@/jd-review/relay";
import { seedOwner } from "./helpers";

const OWNER = "owner1";
function ownedDb(): DB {
  const db = openDb(":memory:");
  seedOwner(db, OWNER);
  return db;
}

function insertRun(db: DB, kind = "jd_review", status = "done", startedAt = "datetime('now')") {
  db.exec(`INSERT INTO executor_runs (kind, status, channel, started_at) VALUES ('${kind}', '${status}', 'headless', ${startedAt})`);
}

describe("maybeStartJdReview", () => {
  const fakeStart = () => { const calls: unknown[] = []; return { calls, fn: ((...args: unknown[]) => { calls.push(args); return { id: 7, pid: 1, logPath: "/x" }; }) as any }; };

  it("starts a headless jd_review run with limit 40 when pending and no live run", () => {
    const db = ownedDb();
    const s = fakeStart();
    const r = maybeStartJdReview(db, { startExecutor: s.fn, hasLiveRun: () => false, pendingCount: () => 5 });
    expect(r).toEqual({ started: true, runId: 7 });
    expect(s.calls[0]).toEqual([db, OWNER, "jd_review", { limit: 40 }, {}, "headless"]);
  });

  it("does nothing before an owner account exists (the run must belong to someone)", () => {
    const db = openDb(":memory:");
    const s = fakeStart();
    expect(maybeStartJdReview(db, { startExecutor: s.fn, hasLiveRun: () => false, pendingCount: () => 5 })).toEqual({ started: false, reason: "no_owner" });
    expect(s.calls).toHaveLength(0);
  });

  it("does nothing when nothing is pending, a run is live, or the daily cap is hit", () => {
    const db = ownedDb();
    const s = fakeStart();
    expect(maybeStartJdReview(db, { startExecutor: s.fn, hasLiveRun: () => false, pendingCount: () => 0 })).toEqual({ started: false, reason: "no_pending" });
    expect(maybeStartJdReview(db, { startExecutor: s.fn, hasLiveRun: () => true, pendingCount: () => 5 })).toEqual({ started: false, reason: "run_live" });
    for (let i = 0; i < JD_REVIEW_DAILY_CAP; i++) insertRun(db);
    insertRun(db, "jd_review", "done", "datetime('now', '-2 days')"); // yesterday's don't count
    expect(jdReviewRunsToday(db)).toBe(JD_REVIEW_DAILY_CAP);
    expect(maybeStartJdReview(db, { startExecutor: s.fn, hasLiveRun: () => false, pendingCount: () => 5 })).toEqual({ started: false, reason: "daily_cap" });
    expect(s.calls).toHaveLength(0);
  });

  it("does nothing when JD_REVIEW_RELAY_DISABLED is set, even with pending work and no live run", () => {
    const db = ownedDb();
    const s = fakeStart();
    process.env.JD_REVIEW_RELAY_DISABLED = "1";
    try {
      expect(maybeStartJdReview(db, { startExecutor: s.fn, hasLiveRun: () => false, pendingCount: () => 5 })).toEqual({ started: false, reason: "disabled" });
    } finally {
      delete process.env.JD_REVIEW_RELAY_DISABLED;
    }
    expect(s.calls).toHaveLength(0);
    // and it is only the env flag: with it gone the same inputs start a run again
    expect(maybeStartJdReview(db, { startExecutor: s.fn, hasLiveRun: () => false, pendingCount: () => 5 })).toEqual({ started: true, runId: 7 });
  });

  it("swallows start failures as reason 'error'", () => {
    const db = ownedDb();
    const r = maybeStartJdReview(db, { startExecutor: (() => { throw new Error("no claude"); }) as any, hasLiveRun: () => false, pendingCount: () => 1 });
    expect(r).toEqual({ started: false, reason: "error" });
  });
});
