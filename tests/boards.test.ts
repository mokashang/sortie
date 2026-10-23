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

describe("persistent non-404 failures (broken tenants / sites)", () => {
  const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
  const fail = (db: ReturnType<typeof openDb>, key: string, n: number, error: string) =>
    markBoardResult(db, key, { ok: false, error, httpStatus: Number(error.match(/HTTP (\d{3})/)?.[1] ?? NaN) || null, now: day(n), rand: () => 0.5 });
  const retiers = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT payload FROM events WHERE kind='board_retier'").all() as { payload: string }[]).map((r) => JSON.parse(r.payload));

  it("mutes after the same status five times in a row spanning a week, logs board_retier, and stays reversible", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "workday:osv-cci.wd1/CCICareers", origin: "url" }]);
    const k = "workday:osv-cci.wd1/CCICareers";
    for (const d of [0, 1, 2, 3, 4]) fail(db, k, d, "workday osv-cci.wd1/CCICareers: HTTP 422");
    expect(getBoard(db, k)!.tier).toBe("longtail");          // 5 次但只跨了 4 天:还不算
    expect(JSON.parse(getBoard(db, k)!.meta!).fail_streak).toMatchObject({ status: 422, n: 5, since: iso(day(0)) });
    fail(db, k, 8, "workday osv-cci.wd1/CCICareers: HTTP 422");
    expect(getBoard(db, k)).toMatchObject({ tier: "muted", tier_reason: "HTTP 422 x6 over 8d", tier_locked: 0, next_due_at: null });
    expect(retiers(db)).toEqual([{ key: k, from: "longtail", to: "muted", reason: "HTTP 422 x6 over 8d" }]);
    // 来源页手动改回:锁定后不再被自动静音
    setBoardTier(db, k, "longtail");
    fail(db, k, 9, "workday osv-cci.wd1/CCICareers: HTTP 422");
    expect(getBoard(db, k)!.tier).toBe("longtail");
  });

  it("does not count rate limits, network errors or maintenance pages, and any success or a new status restarts the count", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "workday:a.wd1/s", origin: "url" }, { key: "workday:b.wd1/s", origin: "url" }, { key: "workday:c.wd1/s", origin: "url" }]);
    // a:每周五晚的维护 + 本机断网 + 429,怎么错都不静音
    for (const [d, e] of [[0, "workday a.wd1/s: response is not JSON (text/html)"], [3, "fetch failed"], [6, "workday a.wd1/s: HTTP 429"], [9, "The operation was aborted due to timeout"], [12, "fetch failed"], [15, "workday a.wd1/s: HTTP 429"]] as const) fail(db, "workday:a.wd1/s", d, e);
    expect(getBoard(db, "workday:a.wd1/s")!.tier).toBe("longtail");
    expect(getBoard(db, "workday:a.wd1/s")!.meta).toBeNull();
    // b:500 中间夹着断网和 429 —— 这几次没看到对方的状态,不打断也不计数;第 5 次 500 跨过 7 天才静音
    for (const [d, e] of [[0, "HTTP 500"], [2, "HTTP 500"], [3, "fetch failed"], [4, "HTTP 429"], [5, "HTTP 500"], [6, "HTTP 500"]] as const) fail(db, "workday:b.wd1/s", d, `workday b.wd1/s: ${e}`);
    expect(getBoard(db, "workday:b.wd1/s")!.tier).toBe("longtail");
    fail(db, "workday:b.wd1/s", 7, "workday b.wd1/s: HTTP 500");
    expect(getBoard(db, "workday:b.wd1/s")!.tier_reason).toBe("HTTP 500 x5 over 7d");
    // c:中间成功一次 / 换了状态,都从头数
    for (const d of [0, 2, 4, 6]) fail(db, "workday:c.wd1/s", d, "workday c.wd1/s: HTTP 422");
    markBoardResult(db, "workday:c.wd1/s", { ok: true, now: day(7), rand: () => 0.5 });
    expect(getBoard(db, "workday:c.wd1/s")!.meta).toBe("{}");
    for (const d of [8, 10, 12, 14]) fail(db, "workday:c.wd1/s", d, "workday c.wd1/s: HTTP 422");
    fail(db, "workday:c.wd1/s", 16, "workday c.wd1/s: HTTP 403");
    expect(getBoard(db, "workday:c.wd1/s")!.tier).toBe("longtail");
    expect(JSON.parse(getBoard(db, "workday:c.wd1/s")!.meta!).fail_streak).toMatchObject({ status: 403, n: 1 });
    expect(retiers(db)).toHaveLength(1);
  });

  it("picks up boards that were already failing before the rule existed, and keeps other meta keys", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [
      { key: "workday:nio.wd3/NIO_Careers", origin: "url" },
      { key: "workday:maint.wd1/s", origin: "url" },
      { key: "github_list:x/y", origin: "url", meta: { etag: "W/1" } },
    ]);
    const legacy = db.prepare("UPDATE boards SET fail_count=?, last_error=?, last_ok_at=?, created_at=? WHERE key=?");
    legacy.run(34, "workday nio.wd3/NIO_Careers: HTTP 422", "2026-08-14 10:00:00", "2026-08-01 00:00:00", "workday:nio.wd3/NIO_Careers");
    legacy.run(1, "workday maint.wd1/s: HTTP 500", "2026-08-01 00:00:00", "2026-07-01 00:00:00", "workday:maint.wd1/s");
    fail(db, "workday:nio.wd3/NIO_Careers", 0, "workday nio.wd3/NIO_Careers: HTTP 422");
    expect(getBoard(db, "workday:nio.wd3/NIO_Careers")!.tier_reason).toBe("HTTP 422 x35 over 23d");
    fail(db, "workday:maint.wd1/s", 0, "workday maint.wd1/s: HTTP 500");   // 一次维护的 500 + 这一次:只算 2 次
    expect(getBoard(db, "workday:maint.wd1/s")!.tier).toBe("longtail");
    fail(db, "github_list:x/y", 0, "github_list x/y: HTTP 500");
    expect(JSON.parse(getBoard(db, "github_list:x/y")!.meta!)).toMatchObject({ etag: "W/1", fail_streak: { status: 500, n: 1 } });
    markBoardResult(db, "github_list:x/y", { ok: true, now: day(1), rand: () => 0.5 });
    expect(JSON.parse(getBoard(db, "github_list:x/y")!.meta!)).toEqual({ etag: "W/1" });
  });

  it("429 waits for Retry-After when given; a cut-short poll comes due again within the hour", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "workable:acme", origin: "url" }, { key: "workday:big.wd1/s", origin: "url" }, { key: "greenhouse:core", origin: "seed" }]);
    markBoardResult(db, "workable:acme", { ok: false, error: "workable acme: HTTP 429 (retry-after 600s)", httpStatus: 429, retryAfterMs: 600_000, now: NOW });
    expect(getBoard(db, "workable:acme")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 600_000)));
    markBoardResult(db, "workday:big.wd1/s", { ok: true, truncated: true, now: NOW, rand: () => 0.5 });
    expect(getBoard(db, "workday:big.wd1/s")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 3600_000)));   // 不等 3 天
    markBoardResult(db, "greenhouse:core", { ok: true, truncated: true, now: NOW, rand: () => 0 });
    expect(getBoard(db, "greenhouse:core")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 0.9 * 3600_000)));   // 本来就不到一小时
  });
});
