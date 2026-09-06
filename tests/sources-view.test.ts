import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { upsertBoards, markBoardResult, setBoardTier } from "@/scanner/boards";
import { sourcesSummary, pagedBoards, recentBoardEvents } from "@/scanner/sources-view";
describe("sources view", () => {
  it("summarizes per family and pages boards with filters", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:a", company: "A", origin: "seed" }, { key: "greenhouse:b", company: "B", origin: "url" }, { key: "workday:t.wd1/s", company: "T", origin: "directory" }]);
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source, board_key) VALUES ('x','A','SWE','greenhouse','greenhouse:a')").run();
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 80)").run();
    markBoardResult(db, "greenhouse:b", { ok: false, error: "HTTP 500", httpStatus: 500, now: new Date() });
    setBoardTier(db, "workday:t.wd1/s", "muted");
    const s = sourcesSummary(db);
    const gh = s.families.find((f) => f.family === "greenhouse")!;
    expect(gh).toMatchObject({ core: 1, longtail: 1, jobs30: 1, ge75_30: 1, errors24h: 1 });
    expect(s.families.find((f) => f.family === "workday")).toMatchObject({ muted: 1 });
    expect(pagedBoards(db, { family: "greenhouse", page: 1, pageSize: 50 }).rows.map((r) => r.key)).toEqual(["greenhouse:a", "greenhouse:b"]);
    expect(pagedBoards(db, { q: "T", page: 1, pageSize: 50 }).total).toBe(1);
    expect(pagedBoards(db, { tier: "muted", page: 1, pageSize: 50 }).total).toBe(1);
    expect(recentBoardEvents(db)[0]).toMatchObject({ key: "workday:t.wd1/s", to: "muted", reason: "user" });
  });
});
