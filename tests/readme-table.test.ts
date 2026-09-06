import { describe, it, expect } from "vitest";
import fs from "fs";
import { parseReadmeTable, parseAge } from "@/scanner/sources/readme-table";
const md = fs.readFileSync("tests/fixtures/sources/zapply-readme.md", "utf8");
const NOW = new Date("2026-09-06T12:00:00Z");
describe("readme table parser", () => {
  it("parses company/title/location/link/age and carries ↳ companies forward", () => {
    const rows = parseReadmeTable(md, { kind: "newgrad", now: NOW });
    expect(rows.length).toBeGreaterThan(2);
    expect(rows[0]).toMatchObject({ company: "Western Digital", title: "Software Engineer", location: "San Jose, CA", source: "github_list", jobKind: "newgrad" });
    expect(rows[0].applyUrl).toBe("https://jobs.smartrecruiters.com/WesternDigital/744000138717897");
    const arrow = "| ↳ | Backend Engineer | Austin, TX | 2d | ✅ Sponsor | [<img src=\"images/apply.png\">](https://jobs.lever.co/x/1) |";
    const r2 = parseReadmeTable("| Company | Role | Location | Posted | Visa | **Apply** |\n|---|---|---|---|---|---|\n| **Acme** | SWE | NYC | 1h | ✅ | [x](https://a.example/1) |\n" + arrow, { kind: "intern", now: NOW });
    expect(r2[1].company).toBe("Acme"); expect(r2[1].jobKind).toBe("intern"); expect(r2[1].applyUrl).toBe("https://jobs.lever.co/x/1");
  });
  it("tolerates rows with fewer cells than the header (no crash, row skipped)", () => {
    const md = "| Company | Role | Location | Posted | Visa | **Apply** |\n|---|---|---|---|---|---|\n| **Acme** | SWE |\n| **Beta** | SWE II | NYC | 1h | ✅ | [x](https://b.example/2) |";
    const rows = parseReadmeTable(md, { kind: "newgrad", now: NOW });
    expect(rows.map((r) => r.company)).toEqual(["Beta"]);
  });
  it("handles a stats table before the jobs table and multiple job tables", () => {
    const md = "| 🛂 Visa | count |\n|---|---|\n| yes | 12 |\n\n## SWE\n| Company | Role | Location | Posted | Visa | **Apply** |\n|---|---|---|---|---|---|\n| **Acme** | SWE | NYC | 1h | ✅ | [x](https://a.example/1) |\n\n## Data\n| Company | Role | Location | Posted | Visa | **Apply** |\n|---|---|---|---|---|---|\n| **Beta** | DS | SF | 2d | ✅ | [x](https://b.example/2) |";
    const rows = parseReadmeTable(md, { kind: "newgrad", now: NOW });
    expect(rows.map((r) => r.company)).toEqual(["Acme", "Beta"]);
  });
  it("converts relative ages", () => {
    expect(parseAge("12m", NOW)).toBe("2026-09-06T11:48:00.000Z");
    expect(parseAge("2d", NOW)).toBe("2026-09-04T12:00:00.000Z");
    expect(parseAge("3w", NOW)).toBe("2026-08-16T12:00:00.000Z");
    expect(parseAge("1mo", NOW)).toBe("2026-08-07T12:00:00.000Z");
    expect(parseAge("?", NOW)).toBeNull();
  });
});
