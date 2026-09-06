import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { computeTier, retierAll, promoteRecentHighScores } from "@/scanner/retier";
import { upsertBoards, getBoard, iso } from "@/scanner/boards";

const base = { origin: "url" as const, tier: "longtail" as const, tier_locked: 0, ge75_90d: 0, ge60_90d: 0, polledDays: 0 };
describe("computeTier", () => {
  it("promotes on yield, demotes idle core, sleeps idle longtail, wakes dormant, respects lock/seed/muted", () => {
    expect(computeTier({ ...base, ge75_90d: 1 })).toMatchObject({ tier: "core" });
    expect(computeTier({ ...base, ge60_90d: 3 })).toMatchObject({ tier: "core" });
    expect(computeTier({ ...base, ge60_90d: 2 })).toBeNull();
    expect(computeTier({ ...base, tier: "core" })).toMatchObject({ tier: "longtail" });
    expect(computeTier({ ...base, tier: "core", origin: "seed" })).toBeNull();
    expect(computeTier({ ...base, origin: "seed" })).toMatchObject({ tier: "core" });
    expect(computeTier({ ...base, polledDays: 31 })).toMatchObject({ tier: "dormant" });
    expect(computeTier({ ...base, polledDays: 29 })).toBeNull();
    expect(computeTier({ ...base, tier: "dormant", ge60_90d: 1 })).toMatchObject({ tier: "longtail" });
    expect(computeTier({ ...base, tier: "dormant" })).toBeNull();
    expect(computeTier({ ...base, tier_locked: 1, ge75_90d: 5 })).toBeNull();
    expect(computeTier({ ...base, tier: "muted", ge75_90d: 5 })).toBeNull();
  });
});
describe("retierAll / promoteRecentHighScores", () => {
  it("applies rules over boards × stats and logs events", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:hot", origin: "url" }, { key: "greenhouse:cold", origin: "url" }, { key: "chrome:tesla", origin: "builtin", tier: "longtail" }]);
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source, board_key) VALUES ('a','Hot','SWE','greenhouse','greenhouse:hot')").run();
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 90)").run();
    const r = retierAll(db, new Date());
    expect(r.changed).toBe(1);
    expect(getBoard(db, "greenhouse:hot")!.tier).toBe("core");
    expect(getBoard(db, "greenhouse:cold")!.tier).toBe("longtail");
    expect(getBoard(db, "chrome:tesla")!.tier).toBe("longtail");
    expect((db.prepare("SELECT COUNT(*) n FROM events WHERE kind='board_retier'").get() as { n: number }).n).toBe(1);
  });
  it("promotes boards whose jobs just scored >= 75", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "ashby:x", origin: "directory" }]);
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source, board_key) VALUES ('a','X','SWE','ashby','ashby:x')").run();
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 80)").run();
    expect(promoteRecentHighScores(db, iso(new Date(Date.now() - 60_000)))).toBe(1);
    const b = getBoard(db, "ashby:x")!;
    expect(b.tier).toBe("core"); expect(b.next_due_at).toBeNull();
  });
});
