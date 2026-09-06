import { DB } from "@/lib/db";
import { RawJob } from "@/scanner/types";
import { fingerprint, dedupKey } from "@/scanner/fingerprint";
import { jdStatusFor } from "@/scanner/jd-status";
import { visaFlag } from "@/scanner/visa-filter";
import { locFlag } from "@/scanner/location-filter";
import { jobKindFromTitle } from "@/scanner/entry-level";
import { parseBoard, atsFromUrl } from "@/scanner/board-key";

export interface UpsertSummary {
  inserted: number;
  upgraded: number;
  duplicates: number;
  visaSkipped: number;
  locSkipped: number;
  errors: { source: string; error: string }[];
}

// 所有来源(调度器的适配器、Chrome 扫描 run 的 ingest)共用的入库逻辑。
//
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
// re-scan and every re-scan counted as an "upgrade" even though nothing changed.
// loc_flag is always set on both insert and the richer-record upgrade path (excluded.loc_flag)
// — location rarely changes between a thin listing-metadata row and its rich ATS counterpart.
// board_key / ats: 由 apply_url 解析(所有来源都算,清单带来的岗也归到它所属的板块);解析不出板块时
// 用调用方给的 boardKey(清单本身、Chrome 站点)。
export function upsertJobs(db: DB, rows: RawJob[], opts: { boardKey?: string | null } = {}): UpsertSummary {
  const summary: UpsertSummary = { inserted: 0, upgraded: 0, duplicates: 0, visaSkipped: 0, locSkipped: 0, errors: [] };
  const findByFp = db.prepare("SELECT id FROM jobs WHERE fingerprint = ?");
  const insJob = db.prepare(
    `INSERT INTO jobs (fingerprint, company, title, location, jd_text, apply_url, source, ats, posted_at, job_kind, visa_flag, loc_flag, dedup_key, jd_status, board_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(fingerprint) DO UPDATE SET
       jd_text=excluded.jd_text,
       visa_flag=excluded.visa_flag,
       loc_flag=excluded.loc_flag,
       apply_url=excluded.apply_url,
       source=excluded.source,
       ats=excluded.ats,
       jd_status=excluded.jd_status,
       board_key=COALESCE(excluded.board_key, jobs.board_key),
       posted_at=COALESCE(excluded.posted_at, jobs.posted_at)
     WHERE excluded.jd_text<>'' AND (jobs.jd_text='' OR jobs.jd_text LIKE '[listing metadata]%')
       AND excluded.jd_text<>jobs.jd_text`
  );
  const insApp = db.prepare("INSERT INTO applications (job_id) VALUES (?)");

  const tx = db.transaction((batch: RawJob[]) => {
    for (const r of batch) {
      const fp = fingerprint(r.company, r.title, r.location);
      const flag = visaFlag(r.jdText);
      const locF = locFlag(r.location);
      const parsed = parseBoard(r.applyUrl);
      const boardKey = parsed?.key ?? opts.boardKey ?? null;
      const ats = r.ats ?? atsFromUrl(r.applyUrl);
      // Pre-check whether this fingerprint already exists: with ON CONFLICT DO UPDATE, .run()
      // no longer throws on conflict (nor does .changes alone distinguish a fresh INSERT from
      // an UPDATE — both report changes=1), so this SELECT is the cleanest way to classify the
      // outcome as insert vs. upgrade vs. untouched-duplicate.
      const existing = findByFp.get(fp) as { id: number } | undefined;
      try {
        const info = insJob.run(
          fp, r.company, r.title, r.location, r.jdText, r.applyUrl,
          r.source, ats, r.postedAt, r.jobKind ?? jobKindFromTitle(r.title), flag, locF,
          dedupKey(r.company, r.title), jdStatusFor(r.jdText), boardKey
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
          // Don't abort the whole batch over one bad row — e.g. a NOT NULL violation from a
          // malformed source record. Isolate it and keep processing the rest.
          summary.errors.push({ source: "insert", error: String(e) });
        }
      }
    }
  });
  tx(rows);
  return summary;
}
