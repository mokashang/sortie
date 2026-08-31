import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchAshby } from "@/scanner/sources/ashby";

const fixture = fs.readFileSync("tests/fixtures/ashby.json", "utf8");
const fakeFetch = async () => new Response(fixture, { status: 200 });

describe("ashby source", () => {
  it("maps jobs and excludes manager titles", async () => {
    const jobs = await fetchAshby("acme", "Acme", fakeFetch);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].applyUrl).toContain("ashbyhq.com");
    expect(jobs[0].source).toBe("ashby");
  });
});
