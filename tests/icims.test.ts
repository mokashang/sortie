import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchIcims, parseIcimsSearch, parseIcimsJob } from "@/scanner/sources/icims";
import type { BoardRow } from "@/scanner/boards";
const search = fs.readFileSync("tests/fixtures/sources/icims-search.html", "utf8");
const job = fs.readFileSync("tests/fixtures/sources/icims-job.html", "utf8");
const board = { key: "icims:careers-sig.icims.com", family: "icims", ident: "careers-sig.icims.com", company: "SIG", origin: "url", tier: "longtail" } as BoardRow;
describe("icims source", () => {
  it("parses 20 job cards (id, url, title) from the search page", () => {
    const cards = parseIcimsSearch(search, "careers-sig.icims.com");
    expect(cards.length).toBe(20);
    expect(cards[0]).toMatchObject({ id: "11099", title: "Analytics Internship: Fall 2026" });
    expect(cards[0].url).toBe("https://careers-sig.icims.com/jobs/11099/analytics-internship%3a-fall-2026/job");
  });
  it("extracts JD text and header fields from a job page", () => {
    const d = parseIcimsJob(job);
    expect(d.jdText).toContain("River's Edge"); expect(d.jdText).not.toContain("<p"); expect(d.fields["Experience Level"]).toBe("Interns + Co-ops");
  });
  it("fetches search pages per keyword then job pages for unknown urls", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => { urls.push(url); return new Response(url.includes("/jobs/search") ? (url.includes("pr=0") ? search : "<html></html>") : job, { status: 200 }); };
    const jobs = await fetchIcims(board, { fetcher, depth: "longtail", isKnownUrl: () => false, now: new Date() });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0].applyUrl).toMatch(/^https:\/\/careers-sig\.icims\.com\/jobs\/\d+\//); expect(jobs[0].source).toBe("icims");
    expect(urls.filter((u) => u.includes("in_iframe=1") && !u.includes("/jobs/search")).length).toBe(jobs.length);
  });
});
