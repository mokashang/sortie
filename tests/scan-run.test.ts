import { describe, it, expect } from "vitest";
import { openDb } from "@/lib/db";
import { syncWatchlist } from "@/scanner/watchlist";
import { runScan } from "@/scanner/run";
import { RawJob } from "@/scanner/types";

const job = (over: Partial<RawJob>): RawJob => ({
  company: "Acme",
  title: "SWE New Grad",
  location: "SF",
  jdText: "",
  applyUrl: "https://a.example",
  source: "greenhouse",
  ats: "greenhouse",
  postedAt: null,
  ...over,
});

describe("runScan", () => {
  it("inserts new jobs, dedupes, applies visa flag, logs summary, isolates source failure", async () => {
    const db = openDb(":memory:");
    syncWatchlist(db, [
      { name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme", directions: ["swe_general"] },
      { name: "Broken", tier: 2, ats: "greenhouse", board_token: "broken", directions: [] },
    ]);
    const sources = {
      greenhouse: async (token: string) => {
        if (token === "broken") throw new Error("HTTP 404");
        return [
          job({}),
          job({}), // 完全重复 → 去重
          job({ title: "SWE II", jdText: "unable to sponsor visas" }),
        ];
      },
      lever: async () => [] as RawJob[],
      ashby: async () => [] as RawJob[],
      githubLists: async () => [job({ company: "ListCo", source: "github_list", ats: null })],
    };
    const summary = await runScan(db, sources);
    expect(summary.inserted).toBe(3);
    expect(summary.upgraded).toBe(0);
    expect(summary.duplicates).toBe(1);
    expect(summary.sourceErrors).toHaveLength(1);
    expect(typeof summary.durationMs).toBe("number");
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    const flagged = db.prepare("SELECT visa_flag FROM jobs WHERE title='SWE II'").get() as { visa_flag: string };
    expect(flagged.visa_flag).toBe("no_sponsor");
    // 失败的公司 probe_status 标记为 failed
    const broken = db.prepare("SELECT probe_status FROM companies WHERE name='Broken'").get() as { probe_status: string };
    expect(broken.probe_status).toBe("failed");
    // 每个新 job 建 application 记录(status=discovered)
    const apps = db.prepare("SELECT COUNT(*) n FROM applications").get() as { n: number };
    expect(apps.n).toBe(3);
    // summary 事件写入 events
    const ev = db.prepare("SELECT COUNT(*) n FROM events WHERE kind='scan_done'").get() as { n: number };
    expect(ev.n).toBe(1);
  });

  it("upgrades a thin (empty/listing-metadata-only) record with a richer record's JD and visa flag when the rich one arrives later, without creating a second application", async () => {
    const db = openDb(":memory:");
    syncWatchlist(db, [{ name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme", directions: [] }]);
    const thin = job({
      company: "ListCo2",
      title: "SWE Upgrade Test",
      location: "Remote",
      jdText: "",
      applyUrl: "https://thin.example",
      source: "github_list",
      ats: null,
    });
    const rich = job({
      company: "ListCo2",
      title: "SWE Upgrade Test",
      location: "Remote",
      jdText: "unable to sponsor visas",
      applyUrl: "https://rich.example",
      source: "greenhouse",
      ats: "greenhouse",
    });

    const s1 = await runScan(db, {
      greenhouse: async () => [],
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [thin],
    });
    expect(s1.inserted).toBe(1);
    expect(s1.upgraded).toBe(0);

    const s2 = await runScan(db, {
      greenhouse: async (token: string) => (token === "acme" ? [rich] : []),
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [],
    });
    expect(s2.inserted).toBe(0);
    expect(s2.upgraded).toBe(1);
    expect(s2.duplicates).toBe(0);

    const row = db
      .prepare("SELECT jd_text, visa_flag, apply_url FROM jobs WHERE company='ListCo2'")
      .get() as { jd_text: string; visa_flag: string; apply_url: string };
    expect(row.jd_text).toBe("unable to sponsor visas");
    expect(row.visa_flag).toBe("no_sponsor");
    expect(row.apply_url).toBe("https://rich.example");

    const apps = db
      .prepare("SELECT COUNT(*) n FROM applications WHERE job_id = (SELECT id FROM jobs WHERE company='ListCo2')")
      .get() as { n: number };
    expect(apps.n).toBe(1);
  });

  it("does not let a later thin record downgrade an already-rich stored record (reverse insert order)", async () => {
    const db = openDb(":memory:");
    syncWatchlist(db, [{ name: "Acme", tier: 1, ats: "greenhouse", board_token: "acme", directions: [] }]);
    const thin = job({
      company: "ListCo3",
      title: "SWE Downgrade Test",
      location: "Remote",
      jdText: "",
      applyUrl: "https://thin.example",
      source: "github_list",
      ats: null,
    });
    const rich = job({
      company: "ListCo3",
      title: "SWE Downgrade Test",
      location: "Remote",
      jdText: "unable to sponsor visas",
      applyUrl: "https://rich.example",
      source: "greenhouse",
      ats: "greenhouse",
    });

    const s1 = await runScan(db, {
      greenhouse: async (token: string) => (token === "acme" ? [rich] : []),
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [],
    });
    expect(s1.inserted).toBe(1);

    const s2 = await runScan(db, {
      greenhouse: async () => [],
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [thin],
    });
    expect(s2.inserted).toBe(0);
    expect(s2.upgraded).toBe(0);
    expect(s2.duplicates).toBe(1);

    const row = db
      .prepare("SELECT jd_text, visa_flag, apply_url FROM jobs WHERE company='ListCo3'")
      .get() as { jd_text: string; visa_flag: string; apply_url: string };
    expect(row.jd_text).toBe("unable to sponsor visas");
    expect(row.visa_flag).toBe("no_sponsor");
    expect(row.apply_url).toBe("https://rich.example");

    const apps = db
      .prepare("SELECT COUNT(*) n FROM applications WHERE job_id = (SELECT id FROM jobs WHERE company='ListCo3')")
      .get() as { n: number };
    expect(apps.n).toBe(1);
  });

  it("does not count a re-scan of the same unchanged listing-metadata marker row as an upgrade (CRITICAL: cron false-positive regression)", async () => {
    const db = openDb(":memory:");
    syncWatchlist(db, []);
    // github_lists emits this exact static marker string every scan for a job still awaiting
    // its rich ATS record — it never changes between scans until a real ATS source picks it up.
    const marker = job({
      company: "ListCo4",
      title: "SWE Marker Test",
      location: "Remote",
      jdText: "[listing metadata] no visa sponsorship",
      applyUrl: "https://marker.example",
      source: "github_list",
      ats: null,
    });

    const s1 = await runScan(db, {
      greenhouse: async () => [],
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [marker],
    });
    expect(s1.inserted).toBe(1);
    expect(s1.upgraded).toBe(0);

    // Same identical marker row scanned again (e.g. next day's cron run, ATS still hasn't
    // published the rich record) must be a plain duplicate, not an "upgrade" — otherwise
    // the cron notification fires every day forever about nothing new.
    const s2 = await runScan(db, {
      greenhouse: async () => [],
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [marker],
    });
    expect(s2.inserted).toBe(0);
    expect(s2.upgraded).toBe(0);
    expect(s2.duplicates).toBe(1);
  });

  it("routes a non-unique-constraint insert failure (e.g. NOT NULL violation) to sourceErrors, not duplicates", async () => {
    const db = openDb(":memory:");
    syncWatchlist(db, []);
    const bad = { ...job({}), title: null } as unknown as RawJob;
    const s = await runScan(db, {
      greenhouse: async () => [],
      lever: async () => [],
      ashby: async () => [],
      githubLists: async () => [bad],
    });
    expect(s.inserted).toBe(0);
    expect(s.upgraded).toBe(0);
    expect(s.duplicates).toBe(0);
    expect(s.sourceErrors.some((e) => e.source === "insert")).toBe(true);
  });
});
