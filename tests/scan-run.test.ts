import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { runScan } from "@/scanner/run";
import type { Registry } from "@/scanner/sources/types";
import { RawJob } from "@/scanner/types";

const job = (over: Partial<RawJob>): RawJob => ({
  company: "Acme", title: "SWE New Grad", location: "SF", jdText: "", applyUrl: "https://boards.greenhouse.io/acme/jobs/1",
  source: "greenhouse", ats: "greenhouse", postedAt: null, ...over,
});

describe("runScan (core sweep wrapper)", () => {
  it("polls the seeded core boards, dedupes, flags visa, keeps the legacy summary shape and logs scan_done", async () => {
    const db = openDb(":memory:");
    const registry: Registry = {
      greenhouse: { concurrency: 2, minGapMs: 0, gated: true, fetch: async (b) => {
        if (b.ident === "broken") throw new Error("greenhouse broken: HTTP 404");
        return [job({}), job({}), job({ title: "SWE II", jdText: "unable to sponsor visas", applyUrl: "https://boards.greenhouse.io/acme/jobs/2" })];
      } },
      github_list: { concurrency: 1, minGapMs: 0, gated: false, fetch: async () => [job({ company: "ListCo", source: "github_list", ats: null, applyUrl: "https://careers.listco.example/1" })] },
    };
    const seed = [{ key: "greenhouse:acme", company: "Acme" }, { key: "greenhouse:broken", company: "Broken" }, { key: "github_list:simplify-newgrad", company: "Simplify", builtin: true }];
    const s = await runScan(db, { registry, seed, localHour: 12 });
    expect(s.inserted).toBe(3);
    expect(s.upgraded).toBe(0);
    expect(s.duplicates).toBe(1);
    expect(s.sourceErrors).toEqual([{ source: "greenhouse:broken", error: "greenhouse broken: HTTP 404" }]);
    expect(s.durationMs).toBeGreaterThanOrEqual(0);
    expect((db.prepare("SELECT visa_flag FROM jobs WHERE title='SWE II'").get() as { visa_flag: string }).visa_flag).toBe("no_sponsor");
    expect((db.prepare("SELECT fail_count FROM boards WHERE key='greenhouse:broken'").get() as { fail_count: number }).fail_count).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM applications").get() as { n: number }).n).toBe(3);
    expect((db.prepare("SELECT COUNT(*) n FROM events WHERE kind='scan_done'").get() as { n: number }).n).toBe(1);
  });
});
