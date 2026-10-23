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
