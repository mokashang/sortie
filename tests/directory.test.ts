import { describe, it, expect } from "vitest";
import fs from "fs";
import { openDb } from "@/lib/db";
import { directoryToSpecs, importDirectory } from "@/scanner/sources/directory";
import { getBoard } from "@/scanner/boards";
const entries = JSON.parse(fs.readFileSync("tests/fixtures/sources/directory-sample.json", "utf8"));
describe("directory import", () => {
  it("maps supported ATS entries to board specs and skips unsupported ones", () => {
    const specs = directoryToSpecs([...entries, { name: "Acosta Group", slug: "eczy.fa.us2.oraclecloud.com", ats: "oracle", host: "eczy.fa.us2.oraclecloud.com", site: "CX_1" }, { name: "Aalyria", slug: "aalyria-careers", ats: "rippling" }]);
    expect(specs.find((s) => s.key === "workday:2020companies.wd1/external_careers")).toMatchObject({ company: "2020 Companies", origin: "directory" });
    expect(specs.find((s) => s.key === "greenhouse:1800contacts")).toBeTruthy();
    expect(specs.find((s) => s.key === "oracle:eczy.fa.us2.oraclecloud.com/CX_1")).toBeTruthy();
    expect(specs.some((s) => s.key.startsWith("rippling"))).toBe(false);
  });
  it("inserts as longtail with next_due_at spread over the window and never overrides existing boards", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-09-06T00:00:00Z");
    db.prepare("INSERT INTO boards (key, family, ident, origin, tier) VALUES ('greenhouse:1800contacts','greenhouse','1800contacts','seed','core')").run();
    const r = importDirectory(db, entries, { now, spreadHours: 72, rand: () => 0.5 });
    expect(r.skipped).toBe(1); expect(r.inserted).toBeGreaterThan(5);
    expect(getBoard(db, "greenhouse:1800contacts")!.tier).toBe("core");
    const b = getBoard(db, "workday:2020companies.wd1/external_careers")!;
    expect(b.tier).toBe("longtail"); expect(b.next_due_at).toBe("2026-09-07 12:00:00");
  });
});
