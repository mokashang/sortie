import { describe, it, expect, vi, afterEach } from "vitest";
import { openDb, DB } from "@/lib/db";
import { runTick, TickSummary } from "@/scanner/scheduler";
import { upsertBoards, getBoard, iso } from "@/scanner/boards";
import { LIVE_REGISTRY } from "@/scanner/sources/index";
import type { Registry } from "@/scanner/sources/types";

// 离线回放一跳扫描(虚拟时钟,不碰网络、不碰生产库),量「一跳要多久」。
// 场景照 2026-10-21 20:34 那一跳(9 个 core Workday 板块,16 分钟):3 个 CVS 量级的大租户
// (每个关键词的命中数是 2026-10-21 对 cvshealth 实测的 total;Workday 的 searchText 是全文模糊搜索)
// + 6 个普通租户 + 2 个 iCIMS 板块。标题构成也照 CVS 第一页:约 5% 工程岗、70% 非工程的「入门」岗
// (Pharmacy Intern / Store Associate,过得了 isEntryLevelTitle、过不了工程标题门)、25% 资深岗。
// 稳态:工程岗大多已入库,每个大租户有 2 个列表搜得到的新工程岗。延迟取实测 330–650 ms。
//
// 2026-10-21 改动前后(同一个文件在改动前的提交上跑):
//   稳态     257 s、11 个到期板块只问了 10 个、详情 1883 次(门外的药房岗每次都重拉) → 33 s、11 个、详情 6 次,入库同样 12 条
//   详情卡死 12012 s(599 次 × 20 秒超时)                                         → 92 s,剩下的新岗一小时后接着拉
const NOW = new Date("2026-10-21T20:34:19Z");
const LIST_MS = 450, DETAIL_MS = 400, ICIMS_SEARCH_MS = 1200, ICIMS_JOB_MS = 900, TIMEOUT_MS = 20_000;
const CVS_TOTALS = [5965, 687, 1973, 4841, 20, 130, 11, 1];   // new grad / new college grad / graduate / intern / early career / university / entry level / campus
const SMALL_TOTALS = [12, 3, 25, 40, 2, 5, 1, 0];

interface Tenant { tenant: string; site: string; totals: number[]; pool: number; detailMs: number; known: (id: number) => boolean; }
const titleOf = (id: number) => (id % 20 === 0 ? `Software Engineer Intern ${id}` : id % 20 < 15 ? `Pharmacy Intern ${id}` : `Senior Pharmacy Manager ${id}`);
const isEng = (id: number) => id % 20 === 0;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function fakeNet(tenants: Tenant[], counts: Record<string, number>) {
  const byHost = new Map(tenants.map((t) => [`${t.tenant}.wd1.myworkdayjobs.com`, t]));
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(url);
    if (u.host.endsWith(".icims.com")) {
      if (u.pathname === "/jobs/search") {
        counts.icimsSearch = (counts.icimsSearch ?? 0) + 1;
        await wait(ICIMS_SEARCH_MS);
        const kw = u.searchParams.get("searchKeyword")!, pr = Number(u.searchParams.get("pr"));
        const total = ({ engineer: 60, software: 30, graduate: 15, intern: 40 } as Record<string, number>)[kw] ?? 0;
        const cards: string[] = [];
        for (let i = pr * 20; i < Math.min(total, pr * 20 + 20); i++) {
          const id = 1000 + ((kw.length * 37 + i) % 90);
          cards.push(`<a href="https://${u.host}/jobs/${id}/job-${id}/job?in_iframe=1" class="iCIMS_Anchor"><h3>${titleOf(id)}</h3></a>`);
        }
        return new Response(`<html>${cards.join("\n")}</html>`, { status: 200 });
      }
      counts.icimsJob = (counts.icimsJob ?? 0) + 1;
      await wait(ICIMS_JOB_MS);
      return new Response(`<div class="iCIMS_Expandable_Text"><p>JD</p></div></div>`, { status: 200 });
    }
    const t = byHost.get(u.host);
    if (!t) return new Response("{}", { status: 404 });
    if (init?.method === "POST") {
      counts.list = (counts.list ?? 0) + 1;
      await wait(LIST_MS);
      const body = JSON.parse(String(init.body)) as { offset: number; limit: number; searchText: string };
      const k = ["new grad", "new college grad", "graduate", "intern", "early career", "university", "entry level", "campus"].indexOf(body.searchText);
      const total = t.totals[k] ?? 0;
      const posts = [];
      for (let i = body.offset; i < Math.min(total, body.offset + body.limit); i++) {
        const id = (k * 131 + i) % t.pool;
        posts.push({ title: titleOf(id), externalPath: `/job/R${id}`, locationsText: "US, CA, Santa Clara", postedOn: "Posted Today" });
      }
      return new Response(JSON.stringify({ total: body.offset === 0 ? total : 0, jobPostings: posts }), { status: 200 });
    }
    counts.detail = (counts.detail ?? 0) + 1;
    await wait(t.detailMs);
    if (t.detailMs >= TIMEOUT_MS) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    return new Response(JSON.stringify({ jobPostingInfo: { jobDescription: "<p>JD</p>", startDate: "2026-10-20", location: "US, CA, Santa Clara" } }), { status: 200 });
  };
}

function seed(db: DB, tenants: Tenant[]) {
  upsertBoards(db, tenants.map((t) => ({ key: `workday:${t.tenant}.wd1/${t.site}`, company: t.tenant, origin: "url" as const, tier: "core" as const })));
  const ins = db.prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url) VALUES (?,?,?,?,?)");
  for (const t of tenants) for (let id = 0; id < t.pool; id++) {
    if (isEng(id) && t.known(id)) ins.run(`${t.tenant}-${id}`, t.tenant, titleOf(id), "workday", `https://${t.tenant}.wd1.myworkdayjobs.com/${t.site}/job/R${id}`);
  }
}

async function replay(db: DB, tenants: Tenant[], families: Registry): Promise<{ s: TickSummary; counts: Record<string, number> }> {
  const counts: Record<string, number> = {};
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: NOW });
  let done = false;
  const p = runTick(db, { now: NOW, registry: families, fetcher: fakeNet(tenants, counts), seed: null, rand: () => 0.5, localHour: 12 }).finally(() => { done = true; });
  while (!done) await vi.advanceTimersToNextTimerAsync();
  return { s: await p, counts };
}

const registry: Registry = { workday: LIVE_REGISTRY.workday!, icims: LIVE_REGISTRY.icims! };
afterEach(() => { vi.useRealTimers(); });

describe("scan tick replay (virtual clock)", () => {
  it("a tick with three CVS-sized Workday tenants stays near its 90 s budget", async () => {
    const db = openDb(":memory:");
    const big = (n: number): Tenant => ({ tenant: `bigco${n}`, site: "Careers", totals: CVS_TOTALS, pool: 1200, detailMs: DETAIL_MS, known: (id) => id % 400 !== 0 });
    const small = (n: number): Tenant => ({ tenant: `smallco${n}`, site: "Careers", totals: SMALL_TOTALS, pool: 60, detailMs: DETAIL_MS, known: () => true });
    const tenants = [big(1), big(2), big(3), ...[1, 2, 3, 4, 5, 6].map(small)];
    seed(db, tenants);
    upsertBoards(db, [{ key: "icims:careers-a.icims.com", company: "A", origin: "url" }, { key: "icims:careers-b.icims.com", company: "B", origin: "url" }]);
    const { s, counts } = await replay(db, tenants, registry);
    console.log("REPLAY steady-state", JSON.stringify({ tickSec: Math.round(s.durationMs / 1000), boards: s.boards, inserted: s.inserted, ...counts }));
    expect(s.boards).toBe(11);
    expect(s.inserted).toBe(12);                             // 6 个 Workday 新工程岗 + 6 个 iCIMS 工程岗,和改动前一样
    expect(counts.detail).toBe(6);                           // 只给门内的新岗拉详情
    expect(s.durationMs).toBeLessThanOrEqual(120_000);
  }, 60_000);

  it("a tenant whose detail calls hang until the 20 s timeout cannot hold the tick for minutes", async () => {
    const db = openDb(":memory:");
    // 刚升 core 的大租户第一次被问:60 个工程岗都没入库,而详情接口每次都卡满 20 秒超时。
    const hung: Tenant = { tenant: "hungco", site: "Careers", totals: CVS_TOTALS, pool: 1200, detailMs: TIMEOUT_MS, known: () => false };
    seed(db, [hung]);
    const { s, counts } = await replay(db, [hung], registry);
    console.log("REPLAY hung-detail", JSON.stringify({ tickSec: Math.round(s.durationMs / 1000), boards: s.boards, inserted: s.inserted, ...counts }));
    expect(s.durationMs).toBeLessThanOrEqual(120_000);
    expect(s.byFamily.workday.truncated).toBe(1);
    expect(getBoard(db, "workday:hungco.wd1/Careers")!.next_due_at).toBe(iso(new Date(NOW.getTime() + 3600_000)));
  }, 60_000);
});
