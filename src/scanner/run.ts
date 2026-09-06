import { DB, logEvent } from "@/lib/db";
import { RawJob } from "@/scanner/types";
import { upsertJobs } from "@/scanner/upsert";
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
  upgraded: number;
  duplicates: number;
  visaSkipped: number;
  locSkipped: number;
  sourceErrors: { source: string; error: string }[];
  durationMs: number;
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
  const startedAt = Date.now();
  const summary: ScanSummary = {
    inserted: 0,
    upgraded: 0,
    duplicates: 0,
    visaSkipped: 0,
    locSkipped: 0,
    sourceErrors: [],
    durationMs: 0,
  };
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

  const s = upsertJobs(db, batches);
  summary.inserted = s.inserted;
  summary.upgraded = s.upgraded;
  summary.duplicates = s.duplicates;
  summary.visaSkipped = s.visaSkipped;
  summary.locSkipped = s.locSkipped;
  summary.sourceErrors.push(...s.errors);

  summary.durationMs = Date.now() - startedAt;
  logEvent(db, "scan_done", { entity: "scanner", payload: summary });
  return summary;
}
