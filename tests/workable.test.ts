import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchWorkable } from "@/scanner/sources/workable";
import type { BoardRow } from "@/scanner/boards";
const raw = JSON.parse(fs.readFileSync("tests/fixtures/sources/workable-list.json", "utf8"));
raw.results.push({ title: "Engineer, Berlin", shortcode: "DE0001", published: "2026-09-01T00:00:00.000Z", location: { country: "Germany", countryCode: "DE", city: "Berlin" } });
raw.nextPage = undefined;
const list = JSON.stringify(raw);
const detail = fs.readFileSync("tests/fixtures/sources/workable-detail.json", "utf8");
const board = { key: "workable:thorlabs", family: "workable", ident: "thorlabs", company: "Thorlabs", origin: "url", tier: "longtail" } as BoardRow;
describe("workable source", () => {
  it("lists via v3, filters non-US, fetches v2 detail, builds apply url", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => { urls.push(url); return new Response(url.includes("/api/v2/") ? detail : list, { status: 200 }); };
    const jobs = await fetchWorkable(board, { fetcher, depth: "core", isKnownUrl: () => false, now: new Date() });
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.some((j) => j.title === "Engineer, Berlin")).toBe(false);
    const j = jobs[0];
    expect(j.applyUrl).toMatch(/^https:\/\/apply\.workable\.com\/thorlabs\/j\/[A-Z0-9]+\/$/);
    expect(j.location).toContain("Newton"); expect(j.jdText).toContain("Thorlabs"); expect(j.source).toBe("workable");
    expect(urls.some((u) => u.includes("/api/v2/accounts/thorlabs/jobs/"))).toBe(true);
  });
});
