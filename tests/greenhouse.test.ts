import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchGreenhouse } from "@/scanner/sources/greenhouse";

const fixture = fs.readFileSync("tests/fixtures/greenhouse.json", "utf8");
const fakeFetch = async () =>
  new Response(fixture, { status: 200, headers: { "content-type": "application/json" } });

describe("greenhouse source", () => {
  it("maps jobs and decodes html entities, keeping only entry-level titles", async () => {
    const jobs = await fetchGreenhouse("acme", "Acme", fakeFetch);
    expect(jobs).toHaveLength(3); // Senior Staff excluded; New Grad + Early Career + shape-drift kept
    const swe = jobs.find((j) => j.title === "Software Engineer, New Grad")!;
    expect(swe.company).toBe("Acme");
    expect(swe.jdText).toContain("unable to sponsor");
    expect(swe.jdText).not.toContain("&lt;");
    expect(swe.source).toBe("greenhouse");
    expect(swe.applyUrl).toBe("https://boards.greenhouse.io/acme/jobs/101");
    expect(swe.postedAt).toBe("2026-08-20T09:00:00-04:00"); // first_published wins over updated_at
  });

  it("tolerates missing optional fields (location/content/dates) without crashing", async () => {
    const jobs = await fetchGreenhouse("acme", "Acme", fakeFetch);
    const shapeDrift = jobs.find((j) => j.title === "Backend Engineer, New Grad")!;
    expect(shapeDrift.location).toBeNull();
    expect(shapeDrift.jdText).toBe("");
    expect(shapeDrift.postedAt).toBeNull();
  });

  it("throws on non-200 (probe failure)", async () => {
    const notFound = async () => new Response("{}", { status: 404 });
    await expect(fetchGreenhouse("nope", "Nope", notFound)).rejects.toThrow(/404/);
  });
});
