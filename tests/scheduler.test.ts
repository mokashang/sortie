import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { runTick, runSweep } from "@/scanner/scheduler";
import { upsertBoards, getBoard, iso } from "@/scanner/boards";
import type { Registry } from "@/scanner/sources/types";
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
  it("syncs the seed on first tick when seed is provided", async () => {
    const db = openDb(":memory:");
    await runTick(db, { now: NOW, registry: {}, seed: [{ key: "ashby:openai", company: "OpenAI" }], localHour: 12 });
    expect(getBoard(db, "ashby:openai")!.tier).toBe("core");
  });
});
