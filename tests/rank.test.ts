import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { COMPOSITE_SCORE_SQL } from "@/apply/rank";
import { pagedQueue } from "@/apply/queue";
describe("composite ranking", () => {
  it("fresh 80 beats 90-day-old 88 but not fresh 90; NULL posted_at counts as 35 days", () => {
    const db = openDb(":memory:");
    const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, posted_at) VALUES (?,?,?,?,?)");
    ins.run("a", "A", "fresh80", "greenhouse", new Date().toISOString());
    ins.run("b", "B", "old88", "greenhouse", new Date(Date.now() - 90 * 86_400_000).toISOString());
    ins.run("c", "C", "fresh90", "greenhouse", new Date().toISOString());
    ins.run("d", "D", "null85", "greenhouse", null);
    db.prepare("INSERT INTO applications (job_id, status) VALUES (1,'matched'),(2,'matched'),(3,'matched'),(4,'matched')").run();
    db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (1,'swe_general',80,1),(2,'swe_general',88,1),(3,'swe_general',90,1),(4,'swe_general',85,1)").run();
    const rows = db.prepare(`SELECT j.title, ${COMPOSITE_SCORE_SQL} AS c FROM jobs j JOIN matches m ON m.job_id = j.id ORDER BY c DESC`).all() as { title: string; c: number }[];
    expect(rows.map((r) => r.title)).toEqual(["fresh90", "fresh80", "null85", "old88"]);
    expect(rows.find((r) => r.title === "old88")!.c).toBe(73); expect(rows.find((r) => r.title === "null85")!.c).toBe(78);
    const paged = pagedQueue(db, { direction: "swe_general", page: 1, pageSize: 10, sort: "composite" });
    expect(paged.rows.map((r) => r.title)).toEqual(["fresh90", "fresh80", "null85", "old88"]);
  });
});
