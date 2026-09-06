import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchBytedance, US_CITIES } from "@/scanner/sources/bytedance";
import type { BoardRow } from "@/scanner/boards";
const list = fs.readFileSync("tests/fixtures/sources/bytedance-list.json", "utf8");
const board = { key: "bytedance:tiktok", family: "bytedance", ident: "tiktok", company: "TikTok", origin: "builtin", tier: "core" } as BoardRow;
describe("bytedance source", () => {
  it("queries the keywords with the storefront header, keeps US cities, builds JD from description+requirement", async () => {
    const calls: { headers: Record<string, string>; body: { portal_type: number; keyword: string; offset: number } }[] = [];
    const fetcher = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push({ headers: init?.headers as Record<string, string>, body });
      return new Response(body.offset === 0 ? list : JSON.stringify({ code: 0, data: { count: 3, job_post_list: [] } }), { status: 200 });
    };
    const jobs = await fetchBytedance(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date() });
    expect(calls[0].headers["website-path"]).toBe("tiktok"); expect(calls[0].body.portal_type).toBe(4);
    expect(new Set(calls.map((c) => c.body.keyword)).size).toBe(4);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) { expect(j.source).toBe("bytedance"); expect(j.company).toBe("TikTok"); expect(US_CITIES.has(j.location!)).toBe(true); expect(j.applyUrl).toMatch(/^https:\/\/lifeattiktok\.com\/search\/\d+$/); }
    expect(jobs[0].jdText).toMatch(/Requirements:/); expect(jobs[0].postedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it("throws when the API returns a non-zero code", async () => {
    const fetcher = async () => new Response(JSON.stringify({ code: -9000003, message: "bad" }), { status: 200 });
    await expect(fetchBytedance(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date() })).rejects.toThrow(/code -9000003/);
  });
});
