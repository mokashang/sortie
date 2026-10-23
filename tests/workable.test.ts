import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchWorkable } from "@/scanner/sources/workable";
import type { BoardRow } from "@/scanner/boards";
// 2026-10-21 从 apply.workable.com/api/v1/widget/accounts/thorlabs?details=true 截的 4 条(正文截短)+ 1 条手写的纯远程岗
const widget = fs.readFileSync("tests/fixtures/sources/workable-widget.json", "utf8");
const board = { key: "workable:thorlabs", family: "workable", ident: "thorlabs", company: "Thorlabs", origin: "url", tier: "longtail" } as BoardRow;
const ctx = (fetcher: (url: string, init?: RequestInit) => Promise<Response>) => ({ fetcher, depth: "core" as const, isKnownUrl: () => false, now: new Date() });

describe("workable source (v1 widget)", () => {
  it("makes one GET per board, keeps US entry-level jobs with their description, builds the same apply url as before", async () => {
    const urls: string[] = [];
    const jobs = await fetchWorkable(board, ctx(async (url, init) => { urls.push(`${init?.method ?? "GET"} ${url}`); return new Response(widget, { status: 200 }); }));
    expect(urls).toEqual(["GET https://apply.workable.com/api/v1/widget/accounts/thorlabs?details=true"]);
    expect(jobs.map((j) => j.title)).toEqual(["Firmware Engineer II", "Epitaxy Engineer I", "Software Engineer, New Grad (Remote)"]); // 经理岗、德国岗不要
    const fw = jobs[0];
    expect(fw.applyUrl).toBe("https://apply.workable.com/thorlabs/j/E349BA9F03/");
    expect(fw.location).toBe("Newton, New Jersey, United States");
    expect(fw.jdText).toContain("Thorlabs"); expect(fw.jdText).toContain("Requirements"); expect(fw.jdText).not.toContain("<p>");
    expect(fw).toMatchObject({ company: "Thorlabs", source: "workable", ats: "workable" });
    expect(fw.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(jobs[2].location).toBe("Remote, US");
  });

  it("skips jobs already in the database (apply_url is not unique, the fingerprint carries the location)", async () => {
    const jobs = await fetchWorkable(board, { ...ctx(async () => new Response(widget, { status: 200 })), isKnownUrl: (u: string) => u.endsWith("/E349BA9F03/") });
    expect(jobs.map((j) => j.title)).toEqual(["Epitaxy Engineer I", "Software Engineer, New Grad (Remote)"]);
  });

  it("reports 429 with the Retry-After the scheduler pauses on", async () => {
    const limited = async () => new Response('{"error":"rate_limit"}', { status: 429, headers: { "retry-after": "23824" } });
    await expect(fetchWorkable(board, ctx(limited))).rejects.toThrow("workable thorlabs: HTTP 429 (retry-after 23824s)");
    const gone = async () => new Response("{}", { status: 404 });
    await expect(fetchWorkable(board, ctx(gone))).rejects.toThrow(/^workable thorlabs: HTTP 404$/);
  });
});
