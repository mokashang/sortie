import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchAmazon, parseAmazonDate } from "@/scanner/sources/amazon";
import type { BoardRow } from "@/scanner/boards";
const page = fs.readFileSync("tests/fixtures/sources/amazon-search.json", "utf8");
const board = { key: "amazon:us", family: "amazon", ident: "us", company: "Amazon", origin: "builtin", tier: "core" } as BoardRow;
describe("amazon source", () => {
  it("runs the graduate queries, maps job_path/posted_date/description", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => { urls.push(url); return new Response(url.includes("offset=0") ? page : JSON.stringify({ hits: 3, jobs: [] }), { status: 200 }); };
    const jobs = await fetchAmazon(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date() });
    expect(urls.some((u) => u.includes("base_query=graduate"))).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
    const j = jobs[0];
    expect(j.applyUrl).toMatch(/^https:\/\/www\.amazon\.jobs\/en\/jobs\/\d+/);
    expect(j.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(j.jdText.length).toBeGreaterThan(100); expect(j.source).toBe("amazon");
    expect(parseAmazonDate("September  4, 2026")).toBe("2026-09-04");
  });
});
