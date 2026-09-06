import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchOracle } from "@/scanner/sources/oracle";
import type { BoardRow } from "@/scanner/boards";
const raw = JSON.parse(fs.readFileSync("tests/fixtures/sources/oracle-list.json", "utf8"));
raw.items[0].requisitionList.push({ Id: "99000001", Title: "Software Engineer I - Campus Hire", PrimaryLocation: "Phoenix, AZ, United States", PostedDate: "2026-09-05", secondaryLocations: [{ Name: "New York, NY, United States" }] });
const list = JSON.stringify(raw);
const detail = fs.readFileSync("tests/fixtures/sources/oracle-detail.json", "utf8");
const board = { key: "oracle:egug.fa.us2.oraclecloud.com/CX_1", family: "oracle", ident: "egug.fa.us2.oraclecloud.com/CX_1", company: "American Express", origin: "url", tier: "longtail" } as BoardRow;
describe("oracle source", () => {
  it("sweeps keywords via the finder, fetches detail, maps location/date", async () => {
    const urls: string[] = [];
    const fetcher = async (url: string) => { urls.push(url); return new Response(url.includes("RequisitionDetails") ? detail : list, { status: 200 }); };
    const jobs = await fetchOracle(board, { fetcher, depth: "longtail", isKnownUrl: () => false, now: new Date() });
    expect(urls.filter((u) => u.includes("recruitingCEJobRequisitions?")).every((u) => u.includes("siteNumber=CX_1"))).toBe(true);
    expect(new Set(urls.filter((u) => u.includes("keyword=")).map((u) => u.match(/keyword=([^,]+)/)![1])).size).toBe(4);
    const j = jobs.find((x) => x.title.startsWith("Software Engineer I"))!;
    expect(j.applyUrl).toBe("https://egug.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/99000001");
    expect(j.postedAt).toBe("2026-09-05"); expect(j.location).toBe("Phoenix, AZ, United States; New York, NY, United States");
    expect(j.jdText).toContain("American Express"); expect(j.jdText).not.toContain("<p"); expect(j.source).toBe("oracle");
  });
});
