import { DB, logEvent } from "@/lib/db";
import { RawJob } from "@/scanner/types";
import { fingerprint } from "@/scanner/fingerprint";
import { visaFlag } from "@/scanner/visa-filter";
import { jobKindFromTitle } from "@/scanner/entry-level";
import { getEnabledCompanies, setProbeStatus } from "@/scanner/watchlist";
import { fetchGreenhouse } from "@/scanner/sources/greenhouse";
import { fetchLever } from "@/scanner/sources/lever";
import { fetchAshby } from "@/scanner/sources/ashby";
import { fetchGithubList, DEFAULT_LISTS } from "@/scanner/sources/github-lists";

export interface ScanSources {
  greenhouse: (token: string, company: string) => Promise<RawJob[]>;
  lever: (token: string, company: string) => Promise<RawJob[]>;
  ashby: (token: string, company: string) => Promise<RawJob[]>;
  githubLists: () => Promise<RawJob[]>;
}

export interface ScanSummary {
  inserted: number;
  duplicates: number;
  visaSkipped: number;
  sourceErrors: { source: string; error: string }[];
}

const LIVE_SOURCES: ScanSources = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  githubLists: async () => {
    const all: RawJob[] = [];
    for (const l of DEFAULT_LISTS) all.push(...(await fetchGithubList(l.url, l.kind)));
    return all;
  },
};

export async function runScan(db: DB, sources: ScanSources = LIVE_SOURCES): Promise<ScanSummary> {
  const summary: ScanSummary = { inserted: 0, duplicates: 0, visaSkipped: 0, sourceErrors: [] };
  const batches: RawJob[] = [];

  try {
    batches.push(...(await sources.githubLists()));
  } catch (e) {
    summary.sourceErrors.push({ source: "github_lists", error: String(e) });
  }

  for (const c of getEnabledCompanies(db, { pollableOnly: true })) {
    const fn = { greenhouse: sources.greenhouse, lever: sources.lever, ashby: sources.ashby }[
      c.ats as "greenhouse" | "lever" | "ashby"
    ];
    try {
      batches.push(...(await fn(c.board_token!, c.name)));
      setProbeStatus(db, c.id, "ok");
    } catch (e) {
      setProbeStatus(db, c.id, "failed");
      summary.sourceErrors.push({ source: `${c.ats}:${c.board_token}`, error: String(e) });
    }
  }

  const insJob = db.prepare(
    `INSERT INTO jobs (fingerprint, company, title, location, jd_text, apply_url, source, ats, posted_at, job_kind, visa_flag)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");

  const tx = db.transaction((rows: RawJob[]) => {
    for (const r of rows) {
      const fp = fingerprint(r.company, r.title, r.location);
      const flag = visaFlag(r.jdText);
      try {
        const info = insJob.run(
          fp, r.company, r.title, r.location, r.jdText, r.applyUrl,
          r.source, r.ats, r.postedAt, r.jobKind ?? jobKindFromTitle(r.title), flag
        );
        insApp.run(info.lastInsertRowid);
        summary.inserted++;
        if (flag) summary.visaSkipped++;
      } catch {
        summary.duplicates++; // UNIQUE(fingerprint) 冲突 = 已见过
      }
    }
  });
  tx(batches);

  logEvent(db, "scan_done", { entity: "scanner", payload: summary });
  return summary;
}
