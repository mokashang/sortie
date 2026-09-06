import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { matchBudget, unscoredBacklog } from "@/scanner/relay";
describe("relay budget", () => {
  it("caps matching per hour and counts eligible unscored jobs", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES ('a','A','SWE','greenhouse'), ('b','B','SWE','greenhouse')").run();
    db.prepare("INSERT INTO applications (job_id) VALUES (1), (2)").run();
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 50)").run();
    expect(matchBudget(db, 10)).toBe(9);
    expect(unscoredBacklog(db)).toBe(1);
  });
});
