import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchSmartRecruiters } from "@/scanner/sources/smartrecruiters";
import type { BoardRow } from "@/scanner/boards";
const raw = JSON.parse(fs.readFileSync("tests/fixtures/sources/smartrecruiters-list.json", "utf8"));
// 真实首页多为资深岗;补一条新人岗保证有东西过入门级标题门
raw.content.push({ id: "744000000000001", name: "Software Engineer, New Grad", releasedDate: "2026-09-01T00:00:00.000Z", location: { city: "San Diego", region: "CALIFORNIA", country: "us", fullLocation: "San Diego, CALIFORNIA, United States" } });
const list = JSON.stringify(raw);
const detail = fs.readFileSync("tests/fixtures/sources/smartrecruiters-detail.json", "utf8");
const board = { key: "smartrecruiters:ServiceNow", family: "smartrecruiters", ident: "ServiceNow", company: "ServiceNow", origin: "url", tier: "longtail" } as BoardRow;
const fetcher = async (url: string) => new Response(/\/postings\/\d+$/.test(url) ? detail : url.includes("offset=0") ? list : JSON.stringify({ totalFound: 4, content: [] }), { status: 200 });
describe("smartrecruiters source", () => {
  it("pages the US postings and fetches detail JD for unknown ones", async () => {
    const jobs = await fetchSmartRecruiters(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date() });
    const j = jobs.find((x) => x.title === "Software Engineer, New Grad")!;
    expect(j).toBeTruthy();
    expect(j.applyUrl).toBe("https://jobs.smartrecruiters.com/ServiceNow/744000000000001");
    expect(j.location).toContain("San Diego"); expect(j.postedAt).toMatch(/^2026-/); expect(j.jdText).toContain("Team");
    expect(j.jdText).not.toContain("<p>"); expect(j.source).toBe("smartrecruiters");
  });
  it("skips known urls without hitting detail", async () => {
    const urls: string[] = [];
    const f = async (url: string) => { urls.push(url); return fetcher(url); };
    await fetchSmartRecruiters(board, { fetcher: f, depth: "core", isKnownUrl: () => true, now: new Date() });
    expect(urls.some((u) => /\/postings\/\d+$/.test(u))).toBe(false);
  });
});
