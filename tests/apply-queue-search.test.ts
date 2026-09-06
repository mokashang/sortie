import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { pagedQueue, pagedAllJobs } from "@/apply/queue";

function seed(db: DB, company: string, title: string) {
  const id = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES (?,?,?,?)")
    .run(`fp-${Math.random()}`, company, title, "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(id, "swe_general", 80, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(id, "matched");
}

describe("queue search", () => {
  it("filters by company or title, case-insensitively, in both paged views", () => {
    const db = openDb(":memory:");
    seed(db, "Stripe", "SWE New Grad");
    seed(db, "Datadog", "Software Engineer Intern");
    seed(db, "Acme", "Stripe integration engineer");
    const base = { direction: "swe_general", page: 1, pageSize: 25, sort: "score" as const };
    expect(pagedQueue(db, { ...base, q: "stripe" }).total).toBe(2);
    expect(pagedQueue(db, { ...base, q: "intern" }).rows.map((r) => r.company)).toEqual(["Datadog"]);
    expect(pagedQueue(db, { ...base, q: "  " }).total).toBe(3);
    expect(pagedQueue(db, base).total).toBe(3);
    expect(pagedAllJobs(db, { page: 1, pageSize: 25, sort: "fresh", q: "acme" }).total).toBe(1);
    expect(pagedAllJobs(db, { page: 1, pageSize: 25, sort: "fresh" }).total).toBe(3);
  });
});
