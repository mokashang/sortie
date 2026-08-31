import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchGithubList } from "@/scanner/sources/github-lists";
import { visaFlag } from "@/scanner/visa-filter";

const fixture = fs.readFileSync("tests/fixtures/github-listings.json", "utf8");
const fakeFetch = async () => new Response(fixture, { status: 200 });

describe("github list source", () => {
  it("keeps active listings, maps sponsorship note into jdText marker", async () => {
    const jobs = await fetchGithubList("https://raw.example/listings.json", "newgrad", fakeFetch);
    expect(jobs).toHaveLength(5); // OldCo (inactive) excluded
    const fortress = jobs.find((j) => j.company === "Fortress")!;
    // 清单声明不 sponsor → 注入标记文本,让统一的 visaFlag 关键词过滤捕获
    expect(fortress.jdText).toContain("no visa sponsorship");
    const nimbus = jobs.find((j) => j.company === "Nimbus")!;
    expect(nimbus.jdText).not.toContain("no visa sponsorship");
    expect(nimbus.postedAt).toMatch(/^2026-/);
  });

  it("sets jobKind from the kind param, independent of title wording", async () => {
    const newgradJobs = await fetchGithubList("https://raw.example/listings.json", "newgrad", fakeFetch);
    const nimbus = newgradJobs.find((j) => j.company === "Nimbus")!;
    expect(nimbus.jobKind).toBe("newgrad");

    // Nimbus's title has no "intern" token — jobKind must come from the kind param,
    // not be re-derived from the title downstream.
    const internJobs = await fetchGithubList("https://raw.example/listings.json", "intern", fakeFetch);
    const nimbusAsIntern = internJobs.find((j) => j.company === "Nimbus")!;
    expect(nimbusAsIntern.jobKind).toBe("intern");
  });

  it("maps the citizenship-required sponsorship value into a jdText marker that visaFlag catches", async () => {
    const jobs = await fetchGithubList("https://raw.example/listings.json", "newgrad", fakeFetch);
    const fortknox = jobs.find((j) => j.company === "Fortknox")!;
    expect(fortknox.jdText).toContain("u.s. citizenship is required");
    expect(visaFlag(fortknox.jdText)).toBe("citizen_only");
  });

  it("tolerates missing optional fields (locations/sponsorship/date_posted) without crashing", async () => {
    const jobs = await fetchGithubList("https://raw.example/listings.json", "newgrad", fakeFetch);
    const ghostly = jobs.find((j) => j.company === "Ghostly")!;
    expect(ghostly.location).toBeNull();
    expect(ghostly.jdText).toBe("");
    expect(ghostly.postedAt).toBeNull();
  });

  it("returns null postedAt for a malformed date_posted instead of throwing", async () => {
    const jobs = await fetchGithubList("https://raw.example/listings.json", "newgrad", fakeFetch);
    const baddate = jobs.find((j) => j.company === "Baddate")!;
    expect(baddate.postedAt).toBeNull();
  });
});
