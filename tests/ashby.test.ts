import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchAshby } from "@/scanner/sources/ashby";

const fixture = fs.readFileSync("tests/fixtures/ashby.json", "utf8");
const fakeFetch = async () => new Response(fixture, { status: 200 });

describe("ashby source", () => {
  it("maps jobs and excludes manager titles", async () => {
    const jobs = await fetchAshby("acme", "Acme", fakeFetch);
    expect(jobs).toHaveLength(2);
    const swe = jobs.find((j) => j.title === "Software Engineer, New Grad")!;
    expect(swe.applyUrl).toContain("ashbyhq.com");
    expect(swe.source).toBe("ashby");
  });

  it("tolerates missing optional fields (location/publishedAt/descriptionPlain/isListed) without crashing", async () => {
    const jobs = await fetchAshby("acme", "Acme", fakeFetch);
    const shapeDrift = jobs.find((j) => j.title.includes("Shape Drift"))!;
    expect(shapeDrift.location).toBeNull();
    expect(shapeDrift.jdText).toBe("");
    expect(shapeDrift.postedAt).toBeNull();
  });
});
