import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { matchBudget, unscoredBacklog, unscoredBacklogFor, matchableUsers, matchSinceFor, MATCH_HORIZON_DAYS } from "@/scanner/relay";
import { importProfileYaml } from "@/lib/profile";
import { seedUser } from "./helpers";

const yaml = `
name: Ann
email: ann@example.com
phone: "1"
linkedin: ""
github: ""
school: USC
degree: MS
grad_date: "2027-05"
work_auth: { status: F-1, needs_sponsorship: true }
targets: { primary: newgrad }
directions: { swe_general: 1 }
`;

describe("relay budget", () => {
  it("caps matching per hour (shared across accounts) and counts each account's eligible unscored jobs", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES ('a','A','SWE','greenhouse'), ('b','B','SWE','greenhouse')").run();
    db.prepare("INSERT INTO applications (user_id, job_id) VALUES ('u1', 1), ('u1', 2), ('u2', 1), ('u2', 2)").run();
    db.prepare("INSERT INTO matches (user_id, job_id, score) VALUES ('u1', 1, 50)").run();
    expect(matchBudget(db, 10)).toBe(9);
    expect(unscoredBacklogFor(db, "u1", "1970-01-01")).toBe(1);
    expect(unscoredBacklogFor(db, "u2", "1970-01-01")).toBe(2);
    // Only accounts with a complete profile are matchable; the horizon starts 45 days before sign-up.
    expect(matchableUsers(db)).toEqual([]);
    expect(unscoredBacklog(db)).toBe(0);
    seedUser(db, "u1", "ann@example.com");
    seedUser(db, "u2", "bob@example.com");
    importProfileYaml(db, "u1", yaml);
    const m = matchableUsers(db);
    expect(m.map((x) => x.user.id)).toEqual(["u1"]);
    expect(unscoredBacklog(db)).toBe(1);
    const since = matchSinceFor({ createdAt: "2026-09-13T00:00:00.000Z" });
    expect(since.startsWith("2026-07-30")).toBe(true);
    expect(MATCH_HORIZON_DAYS).toBe(45);
  });
});
