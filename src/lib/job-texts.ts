import type { DB } from "@/lib/db";

// A posting's description lives in job_texts, one row per job (schema v19, migrateV19 in db.ts),
// so the jobs rows every eligibility filter scans stay a few hundred bytes. Readers join it:
// `LEFT JOIN job_texts t ON t.job_id = j.id` and select `t.jd_text`.
export const SET_JD_TEXT_SQL =
  "INSERT INTO job_texts (job_id, jd_text) VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET jd_text = excluded.jd_text";

export function setJdText(db: DB, jobId: number | bigint, text: string): void {
  db.prepare(SET_JD_TEXT_SQL).run(jobId, text);
}
