import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { COMPOSITE_SCORE_SQL, TIME_PENALTY_SQL } from "@/apply/rank";
import { pagedQueue } from "@/apply/queue";
import { timePenalty, TIME_PENALTY_RULE } from "@/app/lib/time-penalty";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function seed(db: DB, rows: { title: string; score: number; ageDays: number | null; big?: boolean }[]) {
  const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, posted_at) VALUES (?,?,?,?,?)");
  const app = db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'matched')");
  const match = db.prepare("INSERT INTO matches (job_id, direction, score, tier, referral_fit) VALUES (?,'swe_general',?,1,?)");
  rows.forEach((r, i) => {
    ins.run(`fp${i}`, `Co${i}`, r.title, "greenhouse", r.ageDays == null ? null : daysAgo(r.ageDays));
    app.run(i + 1);
    match.run(i + 1, r.score, r.big ? 1 : 0);
  });
}

function composites(db: DB): { title: string; c: number; p: number }[] {
  return db
    .prepare(`SELECT j.title, ${COMPOSITE_SCORE_SQL} AS c, ${TIME_PENALTY_SQL} AS p FROM jobs j JOIN matches m ON m.job_id = j.id ORDER BY c DESC, m.score DESC`)
    .all() as { title: string; c: number; p: number }[];
}

describe("composite ranking (2026-09-11 relaxed time penalty)", () => {
  it("fresh 80 still beats a 90-day-old 88; NULL posted_at counts as 30 days (−3)", () => {
    const db = openDb(":memory:");
    seed(db, [
      { title: "fresh80", score: 80, ageDays: 0 },
      { title: "old88", score: 88, ageDays: 90 },
      { title: "fresh90", score: 90, ageDays: 0 },
      { title: "null85", score: 85, ageDays: null },
    ]);
    const rows = composites(db);
    expect(rows.map((r) => r.title)).toEqual(["fresh90", "null85", "fresh80", "old88"]);
    expect(rows.find((r) => r.title === "old88")!.c).toBe(78); // capped at −10
    expect(rows.find((r) => r.title === "null85")!.c).toBe(82); // 30 days → floor(16/5) = 3
    const paged = pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 10, sort: "composite" });
    expect(paged.rows.map((r) => r.title)).toEqual(["fresh90", "null85", "fresh80", "old88"]);
  });

  it("a well-known company (referral_fit=1) decays at half speed: 30-day-old 88 beats fresh 86 and a 30-day-old 88 elsewhere", () => {
    const db = openDb(":memory:");
    seed(db, [
      { title: "big88_30d", score: 88, ageDays: 30, big: true },
      { title: "fresh86", score: 86, ageDays: 1 },
      { title: "small88_30d", score: 88, ageDays: 30 },
      { title: "big90_60d", score: 90, ageDays: 60, big: true },
      { title: "big90_120d", score: 90, ageDays: 120, big: true },
      { title: "small90_120d", score: 90, ageDays: 120 },
      { title: "bignull80", score: 80, ageDays: null, big: true },
    ]);
    const rows = composites(db);
    const by = Object.fromEntries(rows.map((r) => [r.title, r]));
    expect(by.big88_30d.p).toBe(1); // floor(16/10)
    expect(by.small88_30d.p).toBe(3); // floor(16/5)
    expect(by.big90_60d.p).toBe(4); // floor(46/10)
    expect(by.big90_120d.p).toBe(5); // cap for well-known companies
    expect(by.small90_120d.p).toBe(10); // cap for everyone else
    expect(by.bignull80.p).toBe(1); // 30 days assumed, halved
    expect(rows.map((r) => r.title)).toEqual(["big88_30d", "big90_60d", "fresh86", "big90_120d", "small88_30d", "small90_120d", "bignull80"]);
  });

  it("the SQL and the TS mirror agree day by day, for both company kinds", () => {
    const db = openDb(":memory:");
    // No seeded age sits exactly on a step boundary (14, 19, 24, 29, ... for everyone; 14, 24, 34, ... for well-known
    // companies); each boundary is approached from half a day either side instead. The rows are stamped from JS
    // Date.now() while the SQL ages them with SQLite's own 'now' a moment later, and on Windows those are two
    // different clocks (V8 interpolates QueryPerformanceCounter on top of GetSystemTimeAsFileTime, SQLite reads the
    // coarse one directly), so SQLite can read up to a timer tick (~1 ms) earlier than the Date.now() taken just
    // before it. A row seeded at exactly 24 days then came back as 23.99999 days and floor() landed on the other
    // side of the boundary: the 2026-09-13 flake "big @24d: expected +0 to be 1" under the full suite.
    const ages = [0, 7, 13.5, 14.5, 18.5, 19.5, 23.5, 24.5, 28.5, 29.5, 30, 33.5, 34.5, 43.5, 44.5, 45, 58.5, 59.5, 60, 63.5, 64.5, 65, 100, 365];
    seed(db, [
      ...ages.map((a) => ({ title: `s${a}`, score: 80, ageDays: a })),
      ...ages.map((a) => ({ title: `b${a}`, score: 80, ageDays: a, big: true })),
      { title: "snull", score: 80, ageDays: null },
      { title: "bnull", score: 80, ageDays: null, big: true },
    ]);
    const by = Object.fromEntries(composites(db).map((r) => [r.title, r.p]));
    for (const a of ages) {
      expect(by[`s${a}`], `small @${a}d`).toBe(timePenalty(a, false));
      expect(by[`b${a}`], `big @${a}d`).toBe(timePenalty(a, true));
    }
    expect(by.snull).toBe(timePenalty(null, false));
    expect(by.bnull).toBe(timePenalty(null, true));
    // The checkpoints the rule was designed around.
    expect(timePenalty(14, false)).toBe(0);
    expect(timePenalty(19, false)).toBe(1);
    expect(timePenalty(30, false)).toBe(3);
    expect(timePenalty(60, false)).toBe(9);
    expect(timePenalty(64, false)).toBe(TIME_PENALTY_RULE.capPoints);
    expect(timePenalty(30, true)).toBe(1);
    expect(timePenalty(60, true)).toBe(4);
    expect(timePenalty(64, true)).toBe(TIME_PENALTY_RULE.bigCapPoints);
  });
});
