import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { IngestJobSchema, ingestJobs, knownUrls } from "@/scanner/ingest";
import { upsertBoards, getBoard } from "@/scanner/boards";
describe("ingest", () => {
  it("validates source/url", () => {
    expect(IngestJobSchema.safeParse({ company: "PayPal", title: "SWE New Grad", applyUrl: "https://www.linkedin.com/jobs/view/1/", source: "linkedin" }).success).toBe(true);
    expect(IngestJobSchema.safeParse({ company: "X", title: "SWE", applyUrl: "https://a.example/1", source: "greenhouse" }).success).toBe(false);
    expect(IngestJobSchema.safeParse({ company: "X", title: "SWE", applyUrl: "javascript:alert(1)", source: "tesla" }).success).toBe(false);
  });
  it("upserts with the chrome board key, stamps the board, reports known urls", () => {
    const db = openDb(":memory:");
    upsertBoards(db, [{ key: "chrome:linkedin", origin: "builtin" }]);
    const s = ingestJobs(db, [
      { company: "PayPal", title: "Software Engineer - Recent Graduate", location: "Chicago, IL", jdText: "jd", applyUrl: "https://www.linkedin.com/jobs/view/4463654152/", source: "linkedin", postedAt: "2026-09-04" },
      { company: "Tesla", title: "Firmware Engineer, New Grad", location: "Palo Alto, CA", jdText: "jd", applyUrl: "https://www.tesla.com/careers/search/job/x-1", source: "tesla", postedAt: null },
    ]);
    expect(s.inserted).toBe(2); expect(s.boards.sort()).toEqual(["chrome:linkedin", "chrome:tesla"]);
    expect(db.prepare("SELECT board_key FROM jobs WHERE company='PayPal'").get()).toEqual({ board_key: "linkedin:guest" });
    expect(db.prepare("SELECT board_key, ats FROM jobs WHERE company='Tesla'").get()).toEqual({ board_key: "chrome:tesla", ats: "tesla" });
    expect(getBoard(db, "chrome:linkedin")!.last_ok_at).toBeTruthy();
    expect(knownUrls(db, ["https://www.linkedin.com/jobs/view/4463654152/", "https://nope.example/"])).toEqual(["https://www.linkedin.com/jobs/view/4463654152/"]);
  });
});
