import { describe, it, expect } from "vitest";
import fs from "fs";
import { parseLinkedinCards, parseLinkedinDetail, fetchLinkedinGuest, LINKEDIN_QUERIES } from "@/scanner/sources/linkedin-guest";
import type { BoardRow } from "@/scanner/boards";
const search = fs.readFileSync("tests/fixtures/sources/linkedin-search.html", "utf8");
const detail = fs.readFileSync("tests/fixtures/sources/linkedin-detail.html", "utf8");
const board = { key: "linkedin:guest", family: "linkedin", ident: "guest", company: null, origin: "builtin", tier: "core", last_ok_at: null } as unknown as BoardRow;
describe("linkedin guest source", () => {
  it("parses cards", () => {
    const cards = parseLinkedinCards(search);
    expect(cards.length).toBe(10);
    expect(cards[0]).toMatchObject({ id: "4463654152", title: "Software Engineer - Recent Graduate", company: "PayPal" });
    expect(cards[0].postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(cards[0].location).toBeTruthy();
  });
  it("parses detail", () => {
    const d = parseLinkedinDetail(detail);
    expect(d.title).toBe("Software Engineer - Recent Graduate"); expect(d.company).toBe("PayPal"); expect(d.location).toBe("Chicago, IL");
    expect(d.jdText).toContain("PayPal"); expect(d.criteria["Employment type"]).toBe("Full-time");
  });
  it("runs queries, skips known ids, uses the 7-day window when stale, throws on repeated 429", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => { urls.push(url); return new Response(url.includes("seeMoreJobPostings") ? (url.includes("start=0") ? search : "") : detail, { status: 200 }); };
    const jobs = await fetchLinkedinGuest(board, { fetcher, depth: "longtail", isKnownUrl: (u) => u.includes("4463654152"), now: new Date(), sleep: async () => {} });
    expect(urls.filter((u) => u.includes("f_TPR=r604800")).length).toBeGreaterThan(0); // last_ok_at null → 过去一周
    expect(jobs.every((j) => j.applyUrl !== "https://www.linkedin.com/jobs/view/4463654152/")).toBe(true);
    expect(jobs[0].source).toBe("linkedin"); expect(jobs[0].ats).toBeNull(); expect(jobs[0].jdText).toContain("PayPal");
    const limited = async () => new Response("", { status: 429 });
    await expect(fetchLinkedinGuest(board, { fetcher: limited, depth: "core", isKnownUrl: () => false, now: new Date(), sleep: async () => {} })).rejects.toThrow(/HTTP 429/);
    expect(Object.keys(LINKEDIN_QUERIES).length).toBe(12);
  });
});
