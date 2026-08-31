import { describe, it, expect } from "vitest";
import fs from "fs";
import { fetchGithubList } from "@/scanner/sources/github-lists";

const fixture = fs.readFileSync("tests/fixtures/github-listings.json", "utf8");
const fakeFetch = async () => new Response(fixture, { status: 200 });

describe("github list source", () => {
  it("keeps active listings, maps sponsorship note into jdText marker", async () => {
    const jobs = await fetchGithubList("https://raw.example/listings.json", "newgrad", fakeFetch);
    expect(jobs).toHaveLength(2); // inactive 排除
    const fortress = jobs.find((j) => j.company === "Fortress")!;
    // 清单声明不 sponsor → 注入标记文本,让统一的 visaFlag 关键词过滤捕获
    expect(fortress.jdText).toContain("no visa sponsorship");
    const nimbus = jobs.find((j) => j.company === "Nimbus")!;
    expect(nimbus.jdText).not.toContain("no visa sponsorship");
    expect(nimbus.postedAt).toMatch(/^2026-/);
  });
});
