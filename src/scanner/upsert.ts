import { DB } from "@/lib/db";
import { SET_JD_TEXT_SQL } from "@/lib/job-texts";
import { RawJob } from "@/scanner/types";
import { fingerprint, dedupKey } from "@/scanner/fingerprint";
import { jdStatusFor } from "@/scanner/jd-status";
import { visaFlag } from "@/scanner/visa-filter";
import { locFlag } from "@/scanner/location-filter";
import { jobKindFromTitle } from "@/scanner/entry-level";
import { parseBoard, atsFromUrl } from "@/scanner/board-key";
import { registerUrlBoards } from "@/scanner/boards";

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
// Upsert on fingerprint, but only "win" against an existing row (overwrite the text in job_texts
// and visa_flag/apply_url/source/ats in jobs) when the incoming row is richer than what's stored:
// the stored text is still empty/listing-metadata-only AND the incoming row has real JD text. This
// fixes a critical bug where a thin github_list row (jdText '' or just a sponsorship marker) landing
// after a richer ATS row for the same job would silently discard the real JD and visa_flag —
// or, depending on insert order, a thin row that inserted first would never get upgraded once
// the rich ATS row showed up, since the old code treated every conflict as a no-op duplicate.
// posted_at uses COALESCE so an upgrade never blanks out a posted date the stored row already had.
// The trailing `t.jd_text <> ?` guards against a false "upgrade": the github_lists source re-emits
// the exact same static "[listing metadata] ..." marker string every scan for a job still awaiting
// its rich ATS record, so without this clause the WHERE matched on every single re-scan and every
// re-scan counted as an "upgrade" even though nothing changed.
// loc_flag is always set on both insert and the richer-record upgrade path
// — location rarely changes between a thin listing-metadata row and its rich ATS counterpart.
// board_key / ats: 由 apply_url 解析(所有来源都算,清单带来的岗也归到它所属的板块);解析不出板块时
// 用调用方给的 boardKey(清单本身、Chrome 站点)。新写入(插入 / 升级)的岗位链接解析出的板块若还没登记,
// 当场登记成 url 板块(registerUrlBoards);调用方给的 boardKey 不登记。
export function upsertJobs(db: DB, rows: RawJob[], opts: { boardKey?: string | null; now?: Date } = {}): UpsertSummary {
  const summary: UpsertSummary = { inserted: 0, upgraded: 0, duplicates: 0, visaSkipped: 0, locSkipped: 0, errors: [] };
  const findByFp = db.prepare("SELECT id FROM jobs WHERE fingerprint = ?");
  const insJob = db.prepare(
    `INSERT INTO jobs (fingerprint, company, title, location, apply_url, source, ats, posted_at, job_kind, visa_flag, loc_flag, dedup_key, jd_status, board_key)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  // The last two parameters are both the incoming text.
  const upgradeJob = db.prepare(
    `UPDATE jobs SET
       visa_flag=?,
       loc_flag=?,
       apply_url=?,
       source=?,
       ats=?,
       jd_status=?,
       board_key=COALESCE(?, board_key),
       posted_at=COALESCE(?, posted_at)
     WHERE id = ? AND ?<>'' AND EXISTS (
       SELECT 1 FROM job_texts t WHERE t.job_id = jobs.id
         AND (t.jd_text='' OR t.jd_text LIKE '[listing metadata]%') AND t.jd_text<>?)`
  );
  const setText = db.prepare(SET_JD_TEXT_SQL);
  // One applications row per account for every new job (spec 2026-09-13 accounts §3). Before any
  // account exists (a fresh install, or the minutes between the v16 migration and the owner's
  // sign-up) the row lands in the legacy bucket, which the first account claims.
  const insApp = db.prepare(
    `INSERT OR IGNORE INTO applications (user_id, job_id)
     SELECT u.id, ? FROM "user" u
     UNION ALL SELECT 'legacy', ? WHERE NOT EXISTS (SELECT 1 FROM "user")`
  );

  const seenBoards = new Map<string, string | null>();

  const tx = db.transaction((batch: RawJob[]) => {
    for (const r of batch) {
      const fp = fingerprint(r.company, r.title, r.location);
      const flag = visaFlag(r.jdText);
      const locF = locFlag(r.location);
      const parsed = parseBoard(r.applyUrl);
      const boardKey = parsed?.key ?? opts.boardKey ?? null;
      const ats = r.ats ?? atsFromUrl(r.applyUrl);
      // Whether this fingerprint already exists decides insert vs. upgrade vs. untouched duplicate.
      const existing = findByFp.get(fp) as { id: number } | undefined;
      try {
        let jobId: number | bigint;
        let upgraded = false;
        if (!existing) {
          jobId = insJob.run(
            fp, r.company, r.title, r.location, r.applyUrl,
            r.source, ats, r.postedAt, r.jobKind ?? jobKindFromTitle(r.title), flag, locF,
            dedupKey(r.company, r.title), jdStatusFor(r.jdText), boardKey
          ).lastInsertRowid;
        } else {
          jobId = existing.id;
          upgraded = upgradeJob.run(flag, locF, r.applyUrl, r.source, ats, jdStatusFor(r.jdText), boardKey, r.postedAt, jobId, r.jdText, r.jdText).changes > 0;
        }
        if ((!existing || upgraded) && r.jdText != null) setText.run(jobId, r.jdText);
        if (parsed && (!existing || upgraded) && !seenBoards.has(parsed.key)) seenBoards.set(parsed.key, r.company);
        if (!existing) {
          // Brand-new job: create its application row. Never done for upgrades — the job id
          // (and its application) must stay stable across re-scans of the same fingerprint.
          insApp.run(jobId, jobId);
          summary.inserted++;
          if (flag) summary.visaSkipped++;
          if (locF) summary.locSkipped++;
        } else if (upgraded) {
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
  if (seenBoards.size) registerUrlBoards(db, seenBoards, { now: opts.now });
  return summary;
}
