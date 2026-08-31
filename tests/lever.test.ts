import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchLever } from "@/scanner/sources/lever";

const fixture = fs.readFileSync("tests/fixtures/lever.json", "utf8");
const fakeFetch = async () => new Response(fixture, { status: 200 });

describe("lever source", () => {
  it("maps postings, excludes staff-level, converts epoch to ISO", async () => {
    const jobs = await fetchLever("acme", "Acme", fakeFetch);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toContain("New Grad");
    expect(jobs[0].location).toBe("Palo Alto, CA");
    expect(jobs[0].postedAt).toMatch(/^2026-/);
    expect(jobs[0].source).toBe("lever");
  });
});
