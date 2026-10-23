import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import { fetchWorkday } from "@/scanner/sources/workday";
import type { BoardRow } from "@/scanner/boards";

const list = fs.readFileSync("tests/fixtures/sources/workday-list.json", "utf8");
const detail = fs.readFileSync("tests/fixtures/sources/workday-detail.json", "utf8");
const board = { key: "workday:nvidia.wd5/NVIDIAExternalCareerSite", family: "workday", ident: "nvidia.wd5/NVIDIAExternalCareerSite", company: "NVIDIA", origin: "seed", tier: "core" } as BoardRow;

function fakeFetch(calls: string[]) {
  return async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.endsWith("/jobs")) {
      const body = JSON.parse(String(init?.body));
      return new Response(body.offset === 0 ? list : JSON.stringify({ total: 3, jobPostings: [] }), { status: 200 });
    }
    return new Response(detail, { status: 200 });
  };
}

describe("workday source", () => {
  it("sweeps keywords, dedupes by externalPath, fetches detail for unknown jobs only, maps fields", async () => {
    const calls: string[] = [];
    const jobs = await fetchWorkday(board, { fetcher: fakeFetch(calls), depth: "longtail", isKnownUrl: (u) => u.endsWith("JR2016865"), now: new Date() });
    // fixture 有 3 个 New College Grad 岗(<20 → 每个词只翻一页);JR2016865 已知 → 不拉详情、不返回
    expect(calls.filter((c) => c.startsWith("POST")).length).toBe(8);
    expect(jobs.some((j) => j.applyUrl.endsWith("JR2016865"))).toBe(false);
    expect(jobs.length).toBe(2);
    expect(calls.filter((c) => c.startsWith("GET")).length).toBe(2);
    const j = jobs[0];
    expect(j.source).toBe("workday"); expect(j.ats).toBe("workday"); expect(j.company).toBe("NVIDIA");
    expect(j.applyUrl).toMatch(/^https:\/\/nvidia\.wd5\.myworkdayjobs\.com\/NVIDIAExternalCareerSite\/job\//);
    expect(j.jdText).toContain("NVIDIA"); expect(j.jdText).not.toContain("<p>");
    expect(j.postedAt).toBe("2026-06-25"); expect(j.location).toBe("US, CA, Santa Clara");
  });
  it("throws on non-200 list responses", async () => {
    const bad = async () => new Response("{}", { status: 404 });
    await expect(fetchWorkday(board, { fetcher: bad, depth: "core", isKnownUrl: () => false, now: new Date() })).rejects.toThrow(/HTTP 404/);
  });

  it("stops at the deadline: past it before the first list call → one request, nothing new, reported as truncated", async () => {
    const calls: string[] = [];
    let cut = 0;
    const jobs = await fetchWorkday(board, { fetcher: fakeFetch(calls), depth: "core", isKnownUrl: () => false, now: new Date(), deadline: Date.now() - 1, truncated: () => { cut++; } });
    expect(calls).toHaveLength(1);      // 第一个列表请求总会发
    expect(jobs).toEqual([]);           // 没来得及拉详情的新岗不返回,下次轮询再拉
    expect(cut).toBe(1);
  });
  it("stops fetching details at the deadline and returns only the ones it finished", async () => {
    const T0 = new Date("2026-10-21T20:00:00Z").getTime();
    vi.useFakeTimers({ toFake: ["Date"], now: T0 });
    const calls: string[] = [];
    const inner = fakeFetch(calls);
    const fetcher = async (url: string, init?: RequestInit) => { if (!init?.method) vi.setSystemTime(Date.now() + 1500); return inner(url, init); };
    let cut = 0;
    const jobs = await fetchWorkday(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date(), deadline: T0 + 1000, truncated: () => { cut++; } });
    expect(calls.filter((c) => c.startsWith("GET"))).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect(cut).toBe(1);
  });
  it("skips details for titles the scheduler's gate would drop", async () => {
    const calls: string[] = [];
    const jobs = await fetchWorkday(board, { fetcher: fakeFetch(calls), depth: "longtail", isKnownUrl: () => false, now: new Date(), wantTitle: () => false });
    expect(jobs).toEqual([]);
    expect(calls.filter((c) => c.startsWith("GET"))).toHaveLength(0);
  });
  it("names maintenance pages and rate limits instead of failing inside JSON.parse", async () => {
    const html = async () => new Response("<!DOCTYPE html><html>Workday is down for maintenance</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    await expect(fetchWorkday(board, { fetcher: html, depth: "core", isKnownUrl: () => false, now: new Date() }))
      .rejects.toThrow("workday nvidia.wd5/NVIDIAExternalCareerSite: response is not JSON (text/html)");
    const limited = async () => new Response("{}", { status: 429, headers: { "retry-after": "120" } });
    await expect(fetchWorkday(board, { fetcher: limited, depth: "core", isKnownUrl: () => false, now: new Date() })).rejects.toThrow("workday nvidia.wd5/NVIDIAExternalCareerSite: HTTP 429 (retry-after 120s)");
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("workday: paging and relocated tenants", () => {
  const gatedBoard = { ...board, key: "workday:bigco.wd1/Careers", ident: "bigco.wd1/Careers", company: "BigCo", origin: "url" } as BoardRow;
  const page = (titles: string[], from: number) => JSON.stringify({ jobPostings: titles.map((title, i) => ({ title, externalPath: `/job/R${from + i}`, locationsText: "US, CA, Irvine" })) });

  it("stops paging a keyword after two pages with nothing new it would keep", async () => {
    const calls: { kw: string; offset: number }[] = [];
    const fetcher = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { searchText: string; offset: number };
      calls.push({ kw: body.searchText, offset: body.offset });
      if (body.searchText !== "intern") return new Response(page([], 0), { status: 200 });
      // 第一页有 1 个软件实习,之后全是药房实习(过不了工程标题门),一共 15 页
      const titles = Array.from({ length: 20 }, (_, i) => (body.offset === 0 && i === 0 ? "Software Engineering Intern" : `Pharmacy Intern ${body.offset + i}`));
      return new Response(page(titles, body.offset), { status: 200 });
    };
    const jobs = await fetchWorkday(gatedBoard, { fetcher, depth: "core", isKnownUrl: () => true, now: new Date(0), wantTitle: (t) => /software/i.test(t) });
    expect(jobs).toEqual([]);   // 都已入库
    expect(calls.filter((c) => c.kw === "intern").map((c) => c.offset)).toEqual([0, 20, 40]);   // 不是 15 页
  });

  it("keeps paging when a page's keepable postings were already found under an earlier keyword", async () => {
    // 「new grad」先搜到了 A;「intern」的前三页也都有 A(见过的),第 4 页才有独有的 B —— 不能因为「没新东西」停在第 2 页
    const fetcher = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { searchText: string; offset: number };
      const junk = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Pharmacy Intern ${body.offset + i}`, externalPath: `/job/P-${body.searchText}-${body.offset + i}`, locationsText: "US" }));
      const swe = (id: string) => ({ title: `Software Engineering Intern ${id}`, externalPath: `/job/${id}`, locationsText: "US" });
      if (body.searchText === "new grad") return new Response(JSON.stringify({ jobPostings: [swe("A")] }), { status: 200 });
      if (body.searchText !== "intern") return new Response(JSON.stringify({ jobPostings: [] }), { status: 200 });
      const pageNo = body.offset / 20;
      const posts = pageNo < 3 ? [swe("A"), ...junk(19)] : pageNo === 3 ? [swe("B"), ...junk(19)] : junk(20);
      return new Response(JSON.stringify({ jobPostings: posts }), { status: 200 });
    };
    const jobs = await fetchWorkday(gatedBoard, { fetcher, depth: "core", isKnownUrl: (u) => u.endsWith("/job/A"), now: new Date(0), wantTitle: (t) => /software/i.test(t) });
    expect(jobs.map((j) => j.title)).toEqual(["Software Engineering Intern B"]);
  });

  it("finds a tenant that moved to another pod, reads it from there and reports the new board", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (!url.includes("bigco.wd108.")) return new Response('{"errorCode":"HTTP_422"}', { status: 422 });
      if (init?.method === "POST") return new Response(JSON.parse(String(init.body)).searchText === "intern" ? page(["Software Engineering Intern"], 0) : page([], 0), { status: 200 });
      return new Response(detail, { status: 200 });
    };
    const moved: string[] = [];
    const jobs = await fetchWorkday(gatedBoard, { fetcher, depth: "longtail", isKnownUrl: () => false, now: new Date(0), moved: (k) => moved.push(k) });
    expect(moved).toEqual(["workday:bigco.wd108/Careers"]);
    expect(jobs.map((j) => j.applyUrl)).toEqual(["https://bigco.wd108.myworkdayjobs.com/Careers/job/R0"]);
    expect(urls.filter((u) => u.includes(".wd1.") || u.includes(".wd1/"))).toHaveLength(1);   // 老 pod 只问了一次
  });

  it("when no pod has it: rethrows the 422, remembers the attempt, and does not probe again for 30 days", async () => {
    let n = 0;
    const fetcher = async () => { n++; return new Response("{}", { status: 422 }); };
    const meta: Record<string, unknown>[] = [];
    await expect(fetchWorkday(gatedBoard, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date("2026-10-22T00:00:00Z"), setMeta: (p) => meta.push(p) })).rejects.toThrow("HTTP 422");
    expect(n).toBe(1 + 14);   // 自己 + 其余 14 个 pod
    expect(meta).toEqual([{ pod_probe_at: "2026-10-22T00:00:00.000Z" }]);
    n = 0;
    const tried = { ...gatedBoard, meta: JSON.stringify(meta[0]) } as BoardRow;
    await expect(fetchWorkday(tried, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date("2026-11-01T00:00:00Z") })).rejects.toThrow("HTTP 422");
    expect(n).toBe(1);
  });
});
