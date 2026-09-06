import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { upsertJobs } from "@/scanner/upsert";
import { RawJob } from "@/scanner/types";

const job = (o: Partial<RawJob>): RawJob => ({ company: "Acme", title: "SWE New Grad", location: "SF", jdText: "", applyUrl: "https://boards.greenhouse.io/acme/jobs/1", source: "greenhouse", ats: "greenhouse", postedAt: null, ...o });

describe("upsertJobs", () => {
  it("inserts, dedupes, flags visa/location, creates application rows", () => {
    const db = openDb(":memory:");
    const s = upsertJobs(db, [job({}), job({}), job({ title: "SWE II", jdText: "unable to sponsor visas" }), job({ title: "SWE London", location: "London, UK" })]);
    expect(s).toMatchObject({ inserted: 3, upgraded: 0, duplicates: 1, visaSkipped: 1, locSkipped: 1 });
    expect((db.prepare("SELECT COUNT(*) n FROM applications").get() as { n: number }).n).toBe(3);
  });

  it("writes board_key from the URL and falls back to opts.boardKey; fills ats from the URL", () => {
    const db = openDb(":memory:");
    upsertJobs(db, [
      job({ applyUrl: "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/x_JR1", source: "github_list", ats: null }),
      job({ title: "Other", applyUrl: "https://careers.example.com/jobs/1", source: "github_list", ats: null }),
    ], { boardKey: "github_list:simplify-newgrad" });
    const rows = db.prepare("SELECT title, board_key, ats FROM jobs ORDER BY id").all();
    expect(rows[0]).toEqual({ title: "SWE New Grad", board_key: "workday:nvidia.wd5/NVIDIAExternalCareerSite", ats: "workday" });
    expect(rows[1]).toEqual({ title: "Other", board_key: "github_list:simplify-newgrad", ats: null });
  });

  it("upgrades a thin row with a richer record without creating a second application", () => {
    const db = openDb(":memory:");
    upsertJobs(db, [job({ jdText: "[listing metadata] no visa sponsorship", source: "github_list", ats: null })]);
    const s = upsertJobs(db, [job({ jdText: "Full JD text here. We sponsor visas." })]);
    expect(s).toMatchObject({ inserted: 0, upgraded: 1 });
    const row = db.prepare("SELECT jd_text, source FROM jobs").get() as { jd_text: string; source: string };
    expect(row.source).toBe("greenhouse"); expect(row.jd_text).toContain("Full JD");
    expect((db.prepare("SELECT COUNT(*) n FROM applications").get() as { n: number }).n).toBe(1);
  });
});
