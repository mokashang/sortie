import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { upsertJobs } from "@/scanner/upsert";
import { runTick } from "@/scanner/scheduler";
import { upsertBoards, setBoardTier, getBoard, discoverBoardsFromJobs, iso, DISCOVERY_SPREAD_HOURS } from "@/scanner/boards";
import type { Registry } from "@/scanner/sources/types";
import { RawJob } from "@/scanner/types";

const NOW = new Date("2026-10-21T18:00:00Z");
const SPREAD_END = iso(new Date(NOW.getTime() + DISCOVERY_SPREAD_HOURS * 3600_000));
const listJob = (o: Partial<RawJob>): RawJob => ({ company: "Astera", title: "Software Engineer New Grad", location: "Santa Clara, CA", jdText: "[listing metadata]", applyUrl: "https://job-boards.greenhouse.io/asteraearlycareer2027/jobs/1", source: "github_list", ats: null, postedAt: null, ...o });
const boardCount = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT COUNT(*) n FROM boards").get() as { n: number }).n;

// 岗位链接 → 板块要一直随到随登(2026-10-21:登记只在 v12 迁移里跑过,v18 之后 230 个板块没人问)。
describe("board discovery from job links", () => {
  it("a github_list job pointing at an unknown greenhouse board creates a longtail url board, first poll spread out", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "github_list:simplify-newgrad", origin: "seed" }]);
    upsertJobs(db, [listJob({}), listJob({ title: "Firmware Engineer", applyUrl: "https://job-boards.greenhouse.io/asteraearlycareer2027/jobs/2" })], { boardKey: "github_list:simplify-newgrad", now: NOW });
    const b = getBoard(db, "greenhouse:asteraearlycareer2027")!;
    expect(b).toMatchObject({ family: "greenhouse", ident: "asteraearlycareer2027", company: "Astera", origin: "url", tier: "longtail", tier_locked: 0 });
    expect(b.next_due_at! >= iso(NOW) && b.next_due_at! <= SPREAD_END).toBe(true);
    expect(boardCount(db)).toBe(2);
  });

  it("leaves a known board untouched", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:asteraearlycareer2027", company: "Astera Labs", origin: "seed", directions: ["hardware"] }]);
    db.prepare("UPDATE boards SET next_due_at = '2026-10-22 01:00:00', updated_at = '2026-10-01 00:00:00'").run();
    const before = getBoard(db, "greenhouse:asteraearlycareer2027");
    upsertJobs(db, [listJob({})], { boardKey: "github_list:simplify-newgrad", now: NOW });
    expect(getBoard(db, "greenhouse:asteraearlycareer2027")).toEqual(before);
    expect(boardCount(db)).toBe(1);
  });

  it("a muted or user-locked board keeps its tier", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "greenhouse:gone", origin: "url", tier: "muted" }, { key: "lever:kept", origin: "url" }]);
    setBoardTier(db, "lever:kept", "dormant");
    upsertJobs(db, [
      listJob({ company: "Gone", applyUrl: "https://boards.greenhouse.io/gone/jobs/9" }),
      listJob({ company: "Kept", applyUrl: "https://jobs.lever.co/kept/abc" }),
    ], { now: NOW });
    expect(getBoard(db, "greenhouse:gone")).toMatchObject({ tier: "muted", next_due_at: null });
    expect(getBoard(db, "lever:kept")).toMatchObject({ tier: "dormant", tier_locked: 1 });
  });

  it("never registers caller-supplied keys or the built-in portals (chrome, linkedin)", () => {
    const db = openDb(":memory:");
    upsertJobs(db, [
      listJob({ applyUrl: "https://careers.example.com/jobs/1" }),                       // → github_list:x (caller's)
      listJob({ title: "Autopilot SWE", applyUrl: "https://www.tesla.com/careers/search/job/1" }), // → chrome:tesla
      listJob({ title: "SWE II", applyUrl: "https://www.linkedin.com/jobs/view/123" }),   // → linkedin:guest
    ], { boardKey: "github_list:x", now: NOW });
    expect(db.prepare("SELECT board_key FROM jobs ORDER BY id").all()).toEqual([{ board_key: "github_list:x" }, { board_key: "chrome:tesla" }, { board_key: "linkedin:guest" }]);
    expect(boardCount(db)).toBe(0);
  });

  it("catch-up registers only orphan keys from jobs.board_key", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "ashby:known", origin: "directory" }]);
    const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url, board_key) VALUES (?,?,?,?,?,?)");
    ins.run("f1", "HPE", "SWE", "github_list", "https://hpe.wd5.myworkdayjobs.com/jobsathpe/job/1", "workday:hpe.wd5/jobsathpe");
    ins.run("f2", "HPE", "SWE 2", "github_list", "https://hpe.wd5.myworkdayjobs.com/jobsathpe/job/2", "workday:hpe.wd5/jobsathpe");
    ins.run("f3", "Known", "SWE", "github_list", "https://jobs.ashbyhq.com/known/1", "ashby:known");
    ins.run("f4", "Listed", "SWE", "github_list", "https://careers.example.com/1", "github_list:x");
    expect(discoverBoardsFromJobs(db, { now: NOW, rand: () => 0.5 })).toBe(1);
    expect(getBoard(db, "workday:hpe.wd5/jobsathpe")).toMatchObject({ company: "HPE", origin: "url", tier: "longtail", next_due_at: iso(new Date(NOW.getTime() + DISCOVERY_SPREAD_HOURS * 1800_000)) });
    expect(getBoard(db, "ashby:known")!.origin).toBe("directory");
    expect(getBoard(db, "github_list:x")).toBeUndefined();
    expect(discoverBoardsFromJobs(db, { now: NOW })).toBe(0);
  });

  it("runTick catches up orphans when it syncs the registry, and a discovered board is title-gated when polled", async () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url, board_key) VALUES ('f1','Orphan','SWE','github_list','https://jobs.lever.co/orphan/1','lever:orphan')").run();
    const registry: Registry = {
      github_list: { concurrency: 1, minGapMs: 0, gated: false, fetch: async () => [listJob({ company: "NewCo", applyUrl: "https://boards.greenhouse.io/newco/jobs/1" })] },
      greenhouse: { concurrency: 1, minGapMs: 0, gated: true, fetch: async (b) => [
        listJob({ company: b.company!, jdText: "jd", applyUrl: `https://boards.greenhouse.io/${b.ident}/jobs/1`, source: "greenhouse" }),
        listJob({ company: b.company!, title: "Store Manager", jdText: "jd", applyUrl: `https://boards.greenhouse.io/${b.ident}/jobs/2`, source: "greenhouse" }),
      ] },
      lever: { concurrency: 1, minGapMs: 0, gated: true, fetch: async () => [] },
    };
    const first = await runTick(db, { now: NOW, registry, seed: [{ key: "github_list:simplify-newgrad" }], rand: () => 0.5, localHour: 12 });
    expect(first.boards).toBe(1); // 只问了清单;新登记的板块首轮错开到之后
    expect(getBoard(db, "lever:orphan")).toMatchObject({ origin: "url", tier: "longtail" });
    expect(getBoard(db, "greenhouse:newco")).toMatchObject({ origin: "url", tier: "longtail", company: "NewCo" });

    const later = new Date(NOW.getTime() + (DISCOVERY_SPREAD_HOURS + 1) * 3600_000);
    const second = await runTick(db, { now: later, registry, seed: null, families: ["greenhouse"], localHour: 12 });
    expect(second.boards).toBe(1);
    expect(second).toMatchObject({ inserted: 0, upgraded: 1 }); // 工程岗升级掉清单的薄行;Store Manager 被门挡掉
    expect(db.prepare("SELECT COUNT(*) n FROM jobs WHERE title = 'Store Manager'").get()).toEqual({ n: 0 });
  });
});
