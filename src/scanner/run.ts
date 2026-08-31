import { DB, logEvent } from "@/lib/db";
import { RawJob } from "@/scanner/types";
import { fingerprint } from "@/scanner/fingerprint";
import { visaFlag } from "@/scanner/visa-filter";
import { locFlag } from "@/scanner/location-filter";
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

  const findByFp = db.prepare("SELECT id FROM jobs WHERE fingerprint = ?");
  // Upsert on fingerprint conflict, but only "win" the conflict (overwrite jd_text/visa_flag/
  // apply_url/source/ats) when the incoming row is richer than what's stored: the stored row
  // is still empty/listing-metadata-only AND the incoming row has real JD text. This fixes a
  // critical bug where a thin github_list row (jdText '' or just a sponsorship marker) landing
  // after a richer ATS row for the same job would silently discard the real JD and visa_flag —
  // or, depending on insert order, a thin row that inserted first would never get upgraded once
  // the rich ATS row showed up, since the old code treated every conflict as a no-op duplicate.
  // posted_at uses COALESCE so an upgrade never blanks out a posted date the stored row already had.
  // The trailing `excluded.jd_text<>jobs.jd_text` guards against a false "upgrade": the github_lists
  // source re-emits the exact same static "[listing metadata] ..." marker string every scan for a job
  // still awaiting its rich ATS record, so without this clause the WHERE above matched on every single
  // re-scan (marker jd_text is non-empty and the stored row still looks thin) and every re-scan counted
  // as an "upgrade" even though nothing changed — which made api/scan/route.ts fire a cron notification
  // about "new" upgrades every day, forever, for the same unchanged rows.
  // loc_flag is always set on both insert and the richer-record upgrade path (excluded.loc_flag)
  // — unlike jd_text/visa_flag it isn't gated behind the WHERE's "richer record" check because
  // location rarely changes between a thin listing-metadata row and its rich ATS counterpart, so
  // there's no meaningful "upgrade" semantics to protect here; always mirroring the freshly
  // computed flag keeps it simple and correct either way.
  const insJob = db.prepare(
    `INSERT INTO jobs (fingerprint, company, title, location, jd_text, apply_url, source, ats, posted_at, job_kind, visa_flag, loc_flag)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fingerprint) DO UPDATE SET
       jd_text=excluded.jd_text,
       visa_flag=excluded.visa_flag,
       loc_flag=excluded.loc_flag,
       apply_url=excluded.apply_url,
       source=excluded.source,
       ats=excluded.ats,
       posted_at=COALESCE(excluded.posted_at, jobs.posted_at)
     WHERE excluded.jd_text<>'' AND (jobs.jd_text='' OR jobs.jd_text LIKE '[listing metadata]%')
       AND excluded.jd_text<>jobs.jd_text`
  );
  const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");

  const tx = db.transaction((rows: RawJob[]) => {
    for (const r of rows) {
      const fp = fingerprint(r.company, r.title, r.location);
      const flag = visaFlag(r.jdText);
      const locF = locFlag(r.location);
      // Pre-check whether this fingerprint already exists: with ON CONFLICT DO UPDATE, .run()
      // no longer throws on conflict (nor does .changes alone distinguish a fresh INSERT from
      // an UPDATE — both report changes=1), so this SELECT is the cleanest way to classify the
      // outcome as insert vs. upgrade vs. untouched-duplicate.
      const existing = findByFp.get(fp) as { id: number } | undefined;
      try {
        const info = insJob.run(
          fp, r.company, r.title, r.location, r.jdText, r.applyUrl,
          r.source, r.ats, r.postedAt, r.jobKind ?? jobKindFromTitle(r.title), flag, locF
        );
        if (!existing) {
          // Brand-new job: create its application row. Never done for upgrades — the job id
          // (and its application) must stay stable across re-scans of the same fingerprint.
          insApp.run(info.lastInsertRowid);
          summary.inserted++;
          if (flag) summary.visaSkipped++;
          if (locF) summary.locSkipped++;
        } else if (info.changes > 0) {
          summary.upgraded++;
          // An upgrade that carries a visa flag is exactly the case the rich-record upsert
          // exists to catch — count it, or the metric never reflects the fix working.
          if (flag) summary.visaSkipped++;
          if (locF) summary.locSkipped++;
        } else {
          summary.duplicates++; // conflict existed but WHERE didn't match = already-seen, no richer data
        }
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === "SQLITE_CONSTRAINT_UNIQUE") {
          summary.duplicates++;
        } else {
          // Don't abort the whole batch (and don't rethrow) over one bad row — e.g. a NOT NULL
          // violation from a malformed source record. Isolate it and keep processing the rest.
          summary.sourceErrors.push({ source: "insert", error: String(e) });
        }
      }
    }
  });
  tx(batches);

  summary.durationMs = Date.now() - startedAt;
  logEvent(db, "scan_done", { entity: "scanner", payload: summary });
  return summary;
}
