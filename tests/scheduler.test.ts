import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "@/lib/db";
import { runTick, runSweep, BOARD_MIN_MS, clearFamilyPauses, familyPausedUntil, ownPaceRunning, waitForOwnPaceRuns } from "@/scanner/scheduler";
import { upsertBoards, getBoard, iso } from "@/scanner/boards";
import type { FetchCtx, Registry } from "@/scanner/sources/types";
import { isEngineeringTitle } from "@/scanner/entry-level";
import { RawJob } from "@/scanner/types";

const NOW = new Date("2026-09-06T18:00:00Z");
const job = (o: Partial<RawJob>): RawJob => ({ company: "Acme", title: "Software Engineer New Grad", location: "SF", jdText: "jd", applyUrl: "https://boards.greenhouse.io/acme/jobs/1", source: "greenhouse", ats: "greenhouse", postedAt: null, ...o });

describe("runTick", () => {
  it("polls due boards by family, gates titles for non-seed boards, upserts, writes board state and a scan_tick event", async () => {
    const db = openDb(":memory:");
    upsertBoards(db, [
      { key: "greenhouse:acme", company: "Acme", origin: "url" },
      { key: "greenhouse:seedco", company: "SeedCo", origin: "seed" },
      { key: "workday:t.wd1/site", company: "T", origin: "directory" },
      { key: "greenhouse:broken", origin: "url" },
    ]);
    const registry: Registry = {
      greenhouse: { concurrency: 2, minGapMs: 0, gated: true, fetch: async (b) => {
        if (b.ident === "broken") throw new Error("greenhouse broken: HTTP 404");
        return [job({ company: b.company!, applyUrl: `https://boards.greenhouse.io/${b.ident}/jobs/1` }), job({ company: b.company!, title: "Store Manager", applyUrl: `https://boards.greenhouse.io/${b.ident}/jobs/2` })];
      } },
      workday: { concurrency: 1, minGapMs: 0, gated: true, fetch: async () => [job({ company: "T", source: "workday", ats: "workday", applyUrl: "https://t.wd1.myworkdayjobs.com/site/job/x" })] },
    };
    const s = await runTick(db, { now: NOW, registry, seed: null, rand: () => 0.5, localHour: 12 });
    expect(s.boards).toBe(4);
    expect(s.inserted).toBe(1 + 2 + 1); // url 板块被门挡掉 Store Manager,种子板块不挡
    expect(s.errors).toEqual([{ key: "greenhouse:broken", error: "greenhouse broken: HTTP 404" }]);
    expect(s.byFamily.greenhouse).toEqual({ boards: 3, inserted: 3, errors: 1 });
    expect(getBoard(db, "greenhouse:acme")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 24 * 3600_000)));
    expect(getBoard(db, "greenhouse:broken")!.fail_count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM events WHERE kind='scan_tick'").get() as { n: number }).n).toBe(1);
    const s2 = await runTick(db, { now: NOW, registry, seed: null, localHour: 12 });
    expect(s2.boards).toBe(0);
  });
  it("respects budgetBoards and the keys filter; runSweep forces due", async () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:a", origin: "url" }, { key: "greenhouse:b", origin: "url" }]);
    const registry: Registry = { greenhouse: { concurrency: 1, minGapMs: 0, gated: false, fetch: async () => [] } };
    expect((await runTick(db, { now: NOW, registry, seed: null, budgetBoards: 1, localHour: 12 })).boards).toBe(1);
    expect((await runTick(db, { now: NOW, registry, seed: null, keys: ["greenhouse:b"], localHour: 12 })).boards).toBe(1);
    expect((await runTick(db, { now: NOW, registry, seed: null, localHour: 12 })).boards).toBe(0);
    expect((await runSweep(db, { now: NOW, registry, seed: null, tiers: ["longtail"], localHour: 12 })).boards).toBe(2);
  });
  it("caps boards per family in a tick, but a sweep asks every board", async () => {
    const db = openDb(":memory:");
    upsertBoards(db, ["a", "b", "c"].map((k) => ({ key: `greenhouse:${k}`, origin: "url" as const })));
    const registry: Registry = { greenhouse: { concurrency: 1, minGapMs: 0, gated: false, fetch: async () => [] } };
    expect((await runTick(db, { now: NOW, registry, seed: null, perFamily: 1, localHour: 12 })).boards).toBe(1);
    expect((await runSweep(db, { now: NOW, registry, seed: null, localHour: 12 })).boards).toBe(3);
  });
  it("syncs the seed on first tick when seed is provided", async () => {
    const db = openDb(":memory:");
    await runTick(db, { now: NOW, registry: {}, seed: [{ key: "ashby:openai", company: "OpenAI" }], localHour: 12 });
    expect(getBoard(db, "ashby:openai")!.tier).toBe("core");
  });
});

describe("runTick: rate limits and per-board time", () => {
  beforeEach(() => clearFamilyPauses());

  it("a 429 on a shared-host family stops that family for the tick and pauses it until Retry-After", async () => {
    const db = openDb(":memory:");
    upsertBoards(db, ["a", "b", "c"].map((k) => ({ key: `workable:${k}`, origin: "url" as const })));
    upsertBoards(db, [{ key: "greenhouse:x", origin: "url" }, { key: "greenhouse:y", origin: "url" }]);
    const asked: string[] = [];
    const registry: Registry = {
      workable: { concurrency: 1, minGapMs: 0, gated: false, sharedHost: true, fetch: async (b) => { asked.push(b.key); throw new Error(`workable ${b.ident}: HTTP 429 (retry-after 600s)`); } },
      // 不共用主机的 family:一个板块 429 不影响别的板块
      greenhouse: { concurrency: 1, minGapMs: 0, gated: false, fetch: async (b) => { asked.push(b.key); if (b.ident === "x") throw new Error("greenhouse x: HTTP 429"); return []; } },
    };
    const s = await runTick(db, { now: NOW, registry, seed: null, localHour: 12 });
    expect(asked.filter((k) => k.startsWith("workable:"))).toEqual(["workable:a"]);
    expect(asked.filter((k) => k.startsWith("greenhouse:"))).toEqual(["greenhouse:x", "greenhouse:y"]);
    expect(s.byFamily.workable).toEqual({ boards: 1, inserted: 0, errors: 1, pausedUntil: iso(new Date(NOW.getTime() + 600_000)) });
    expect(getBoard(db, "workable:a")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 600_000)));
    expect(getBoard(db, "workable:b")!.next_due_at).toBeNull();          // 没问过,不受罚,歇完照常到期
    expect(getBoard(db, "greenhouse:x")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 24 * 3600_000)));
    expect(familyPausedUntil("workable", NOW)).toEqual(new Date(NOW.getTime() + 600_000));
    // 歇着的时候整个 family 不出现在到期列表里;歇完接着问
    expect((await runTick(db, { now: new Date(NOW.getTime() + 300_000), registry, seed: null, localHour: 12 })).byFamily.workable).toBeUndefined();
    registry.workable!.fetch = async (b) => { asked.push(b.key); return []; };
    const later = await runTick(db, { now: new Date(NOW.getTime() + 601_000), registry, seed: null, localHour: 12 });
    expect(later.byFamily.workable).toEqual({ boards: 3, inserted: 0, errors: 0 });   // a 的 Retry-After 也到了
  });

  it("a board that moved: registers the new one with the old one's origin and tier, mutes the old one, polls neither again right away", async () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "workday:netflix.wd1/Netflix", company: "Netflix", origin: "seed", directions: ["swe_general"] }]);
    const registry: Registry = { workday: { concurrency: 1, minGapMs: 0, gated: true, fetch: async (_b, ctx) => {
      ctx.moved?.("workday:netflix.wd108/Netflix");
      return [job({ company: "Netflix", source: "workday", ats: "workday", applyUrl: "https://netflix.wd108.myworkdayjobs.com/Netflix/job/R1" })];
    } } };
    const s = await runTick(db, { now: NOW, registry, seed: null, rand: () => 0.5, localHour: 12 });
    expect(s.inserted).toBe(1);
    expect(s.byFamily.workday.moved).toBe(1);
    expect(getBoard(db, "workday:netflix.wd108/Netflix")).toMatchObject({ origin: "seed", tier: "core", company: "Netflix", directions: '["swe_general"]', next_due_at: iso(new Date(NOW.getTime() + 3 * 3600_000)) });
    expect(getBoard(db, "workday:netflix.wd1/Netflix")).toMatchObject({ tier: "muted", tier_reason: "moved to workday:netflix.wd108/Netflix", tier_locked: 0, next_due_at: null });
    const ev = db.prepare("SELECT payload FROM events WHERE kind='board_retier'").all() as { payload: string }[];
    expect(ev.map((e) => JSON.parse(e.payload).reason)).toEqual(["moved to workday:netflix.wd108/Netflix"]);
    expect((await runTick(db, { now: NOW, registry, seed: null, localHour: 12 })).boards).toBe(0);
  });

  it("runs an own-pace board in the background: the tick does not wait, it never runs twice at once, a sweep runs it inline", async () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "linkedin:guest", origin: "builtin" }, { key: "greenhouse:a", origin: "url" }]);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let calls = 0;
    const registry: Registry = {
      linkedin: { concurrency: 1, minGapMs: 0, gated: false, ownPace: true, fetch: async (_b, ctx) => {
        calls++;
        expect(ctx.deadline).toBeUndefined();                  // 不受跳的截止时刻约束
        await gate;
        return [job({ company: "Acme", title: "Software Engineer New Grad", applyUrl: "https://www.linkedin.com/jobs/view/1/", source: "linkedin", ats: null })];
      } },
      greenhouse: { concurrency: 1, minGapMs: 0, gated: false, fetch: async () => [] },
    };
    const s = await runTick(db, { now: NOW, registry, seed: null, rand: () => 0.5, localHour: 12 });   // 不等 LinkedIn 就返回
    expect(s.ownPaceStarted).toEqual(["linkedin:guest"]);
    expect(s.byFamily.greenhouse.boards).toBe(1);
    expect(s.byFamily.linkedin).toBeUndefined();
    expect(ownPaceRunning()).toEqual(["linkedin:guest"]);
    await runTick(db, { now: NOW, registry, seed: null, localHour: 12 });                              // 还在跑:不再开
    await runSweep(db, { now: NOW, registry, seed: null, keys: ["linkedin:guest"], localHour: 12 });   // 「问一次」也不重叠
    expect(calls).toBe(1);
    release();
    await waitForOwnPaceRuns();
    expect(ownPaceRunning()).toEqual([]);
    expect(getBoard(db, "linkedin:guest")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 2 * 3600_000)));
    const ev = db.prepare("SELECT payload FROM events WHERE kind='scan_board'").all() as { payload: string }[];
    expect(ev.map((e) => JSON.parse(e.payload))).toMatchObject([{ key: "linkedin:guest", boards: 1, inserted: 1 }]);
    // 「问一次」当场跑完,结果在返回值里
    const sweep = await runSweep(db, { now: NOW, registry, seed: null, keys: ["linkedin:guest"], localHour: 12 });
    expect(sweep.byFamily.linkedin).toMatchObject({ boards: 1 });
    expect(calls).toBe(2);
  });

  it("hands adapters a deadline, the title gate (non-seed only) and a truncation hook", async () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "workday:dir.wd1/s", origin: "directory" }, { key: "workday:seed.wd1/s", origin: "seed" }]);
    const seen: Record<string, Pick<FetchCtx, "deadline" | "wantTitle">> = {};
    const registry: Registry = { workday: { concurrency: 2, minGapMs: 0, gated: true, fetch: async (b, ctx) => {
      seen[b.ident] = { deadline: ctx.deadline, wantTitle: ctx.wantTitle };
      if (b.ident === "dir.wd1/s") ctx.truncated?.();
      return [];
    } } };
    const before = Date.now();
    const s = await runTick(db, { now: NOW, registry, seed: null, localHour: 12, budgetMs: 1000 });
    expect(seen["dir.wd1/s"].wantTitle).toBe(isEngineeringTitle);
    expect(seen["seed.wd1/s"].wantTitle).toBeUndefined();
    // 预算只有 1 秒,但每个板块至少有 BOARD_MIN_MS
    expect(seen["dir.wd1/s"].deadline!).toBeGreaterThanOrEqual(before + BOARD_MIN_MS);
    expect(s.byFamily.workday.truncated).toBe(1);
    expect(getBoard(db, "workday:dir.wd1/s")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 3600_000)));
  });
});
