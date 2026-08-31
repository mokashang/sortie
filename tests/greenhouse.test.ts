import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchGreenhouse } from "@/scanner/sources/greenhouse";

const fixture = fs.readFileSync("tests/fixtures/greenhouse.json", "utf8");
const fakeFetch = async () =>
  new Response(fixture, { status: 200, headers: { "content-type": "application/json" } });

describe("greenhouse source", () => {
  it("maps jobs and decodes html entities, keeping only entry-level titles", async () => {
    const jobs = await fetchGreenhouse("acme", "Acme", fakeFetch);
    expect(jobs).toHaveLength(2); // Senior Staff 被 entry-level 标题过滤器排除
    const swe = jobs.find((j) => j.title.includes("New Grad"))!;
    expect(swe.company).toBe("Acme");
    expect(swe.jdText).toContain("unable to sponsor");
    expect(swe.jdText).not.toContain("&lt;");
    expect(swe.source).toBe("greenhouse");
    expect(swe.applyUrl).toBe("https://boards.greenhouse.io/acme/jobs/101");
  });

  it("throws on non-200 (probe failure)", async () => {
    const notFound = async () => new Response("{}", { status: 404 });
    await expect(fetchGreenhouse("nope", "Nope", notFound)).rejects.toThrow(/404/);
  });
});
