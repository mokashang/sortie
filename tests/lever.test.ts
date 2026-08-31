import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchLever } from "@/scanner/sources/lever";

const fixture = fs.readFileSync("tests/fixtures/lever.json", "utf8");
const fakeFetch = async () => new Response(fixture, { status: 200 });

describe("lever source", () => {
  it("maps postings, excludes staff-level, converts epoch to ISO", async () => {
    const jobs = await fetchLever("acme", "Acme", fakeFetch);
    expect(jobs).toHaveLength(3); // ab2 (Staff) excluded; ab1/ab3/ab4 kept
    expect(jobs[0].title).toContain("New Grad");
    expect(jobs[0].location).toBe("Palo Alto, CA");
    expect(jobs[0].postedAt).toMatch(/^2026-/);
    expect(jobs[0].source).toBe("lever");
  });

  it("tolerates missing optional fields (categories/descriptionPlain) without crashing", async () => {
    const jobs = await fetchLever("acme", "Acme", fakeFetch);
    const shapeDrift = jobs.find((j) => j.title.includes("Shape Drift"))!;
    expect(shapeDrift.location).toBeNull();
    expect(shapeDrift.jdText).toBe("");
  });

  it("returns null postedAt for malformed createdAt instead of throwing", async () => {
    const jobs = await fetchLever("acme", "Acme", fakeFetch);
    const badDate = jobs.find((j) => j.title.includes("Bad Date"))!;
    expect(badDate.postedAt).toBeNull();
  });
});
