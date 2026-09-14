import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { upsertBoards, syncBoardsSeed, discoverBoardsFromJobs, dueBoards, markBoardResult, nextDueAfter, getBoard, boardStats, iso, setBoardTier, muteBoard } from "@/scanner/boards";

const NOW = new Date("2026-09-06T10:00:00Z");

describe("boards", () => {
  it("upserts, keeps user tier when locked, promotes seeds to core", () => {
    const db = openDb(":memory:");
    expect(upsertBoards(db, [{ key: "greenhouse:acme", company: "Acme", origin: "url" }])).toEqual({ inserted: 1, touched: 0 });
    expect(getBoard(db, "greenhouse:acme")!.tier).toBe("longtail");
    syncBoardsSeed(db, [{ key: "greenhouse:acme", directions: ["swe_general"] }]);
    const b = getBoard(db, "greenhouse:acme")!;
    expect(b.origin).toBe("seed"); expect(b.tier).toBe("core"); expect(b.company).toBe("Acme");
    setBoardTier(db, "greenhouse:acme", "muted");
    syncBoardsSeed(db, [{ key: "greenhouse:acme" }]);
    expect(getBoard(db, "greenhouse:acme")!.tier).toBe("muted");
  });

  it("discovers boards from jobs.board_key", () => {
    const db = openDb(":memory:");
    const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url, board_key) VALUES (?,?,?,?,?,?)");
    ins.run("f1", "Zoox", "SWE", "github_list", "https://jobs.lever.co/zoox/1", "lever:zoox");
    ins.run("f2", "Zoox", "SWE 2", "github_list", "https://jobs.lever.co/zoox/2", "lever:zoox");
    expect(discoverBoardsFromJobs(db)).toBe(1);
    const b = getBoard(db, "lever:zoox")!;
    expect(b.origin).toBe("url"); expect(b.company).toBe("Zoox"); expect(b.tier).toBe("longtail");
  });

  it("selects due boards in tier order, skipping muted/chrome and linkedin outside 8-22", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [
      { key: "greenhouse:a", origin: "url" },
      { key: "greenhouse:b", origin: "seed" },
      { key: "chrome:tesla", origin: "builtin" },
      { key: "linkedin:guest", origin: "builtin" },
      { key: "ashby:m", origin: "url", tier: "muted" },
    ]);
    db.prepare("UPDATE boards SET next_due_at = ? WHERE key = 'greenhouse:a'").run(iso(new Date(NOW.getTime() + 3600_000)));
    expect(dueBoards(db, { now: NOW, limit: 10, localHour: 12 }).map((b) => b.key)).toEqual(["greenhouse:b", "linkedin:guest"]);
    expect(dueBoards(db, { now: NOW, limit: 10, localHour: 23 }).map((b) => b.key)).toEqual(["greenhouse:b"]);
    expect(dueBoards(db, { now: NOW, limit: 10, localHour: 12, keys: ["greenhouse:a"] })).toHaveLength(0);
  });

  it("writes poll results: cadence with jitter, exponential backoff, 429 → tomorrow, 404×5 → muted", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:a", origin: "seed" }, { key: "greenhouse:gone", origin: "url" }]);
    const rand = () => 0.5;
    markBoardResult(db, "greenhouse:a", { ok: true, now: NOW, rand });
    let b = getBoard(db, "greenhouse:a")!;
    expect(b.next_due_at).toBe(iso(new Date(NOW.getTime() + 3600_000)));
    expect(b.last_ok_at).toBe(iso(NOW)); expect(b.fail_count).toBe(0);
    markBoardResult(db, "greenhouse:a", { ok: false, error: "greenhouse a: HTTP 500", httpStatus: 500, now: NOW, rand });
    b = getBoard(db, "greenhouse:a")!;
    expect(b.fail_count).toBe(1); expect(b.next_due_at).toBe(iso(new Date(NOW.getTime() + 2 * 3600_000)));
    markBoardResult(db, "greenhouse:a", { ok: false, error: "HTTP 429", httpStatus: 429, now: NOW, rand });
    expect(getBoard(db, "greenhouse:a")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 24 * 3600_000)));
    for (let i = 0; i < 5; i++) markBoardResult(db, "greenhouse:gone", { ok: false, error: "greenhouse gone: HTTP 404", httpStatus: 404, now: NOW, rand });
    b = getBoard(db, "greenhouse:gone")!;
    expect(b.tier).toBe("muted"); expect(b.tier_reason).toBe("404 x5");
    expect(db.prepare("SELECT COUNT(*) n FROM events WHERE kind='board_retier'").get()).toEqual({ n: 1 });
    expect(nextDueAfter("core", 0, NOW, () => 0)).toBe(iso(new Date(NOW.getTime() + 3600_000 * 0.9)));
    expect(nextDueAfter("core", 0, NOW, () => 1)).toBe(iso(new Date(NOW.getTime() + 3600_000 * 1.1)));
    expect(nextDueAfter("muted", 0, NOW)).toBeNull();
    // 贵/敏感的家族周期拉长:workday ×3、linkedin ×2
    expect(nextDueAfter("core", 0, NOW, () => 0.5, "workday")).toBe(iso(new Date(NOW.getTime() + 3 * 3600_000)));
    expect(nextDueAfter("core", 0, NOW, () => 0.5, "linkedin")).toBe(iso(new Date(NOW.getTime() + 2 * 3600_000)));
  });

  it("aggregates yield stats per board from jobs × matches", () => {
    const db = openDb(":memory:");
    const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, board_key) VALUES (?,?,?,?,?)");
    ins.run("a", "Acme", "SWE 1", "greenhouse", "greenhouse:acme");
    ins.run("b", "Acme", "SWE 2", "greenhouse", "greenhouse:acme");
    ins.run("c", "Other", "SWE 3", "greenhouse", "greenhouse:other");
    db.prepare("INSERT INTO matches (job_id, score) VALUES (1, 80), (2, 62), (3, 30)").run();
    const s = boardStats(db);
    expect(s.get("greenhouse:acme")).toMatchObject({ ge75_90d: 1, ge60_90d: 2, jobs30: 2, ge75_30: 1 });
    expect(s.get("greenhouse:other")).toMatchObject({ ge75_90d: 0, ge60_90d: 0, jobs30: 1 });
  });
});

describe("muteBoard (executor saw the whole board vanish)", () => {
  it("mutes an active board with the reason, unlocked, and logs the retier; ignores unknown or already-muted keys", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "ashby:cursor", company: "Anysphere", origin: "url" }]);
    muteBoard(db, "ashby:cursor", "executor: board gone");
    expect(getBoard(db, "ashby:cursor")).toMatchObject({ tier: "muted", tier_reason: "executor: board gone", tier_locked: 0, next_due_at: null });
    const events = db.prepare("SELECT payload FROM events WHERE kind = 'board_retier'").all() as { payload: string }[];
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0].payload)).toMatchObject({ key: "ashby:cursor", to: "muted" });
    muteBoard(db, "ashby:cursor", "again");
    muteBoard(db, "greenhouse:nobody", "x");
    expect(getBoard(db, "ashby:cursor")!.tier_reason).toBe("executor: board gone");
    expect(db.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'board_retier'").get()).toEqual({ n: 1 });
  });
});
