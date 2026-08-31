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
    expect(summary.duplicates).toBe(1);
    expect(summary.sourceErrors).toHaveLength(1);
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
});
