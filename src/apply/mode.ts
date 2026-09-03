import { DB } from "@/lib/db";

// The single source of truth for "which apply mode does this job effectively use". The user's
// explicit override (applications.apply_mode) wins; otherwise Claude's suggestion
// (matches.referral_fit = 1 → referral); an unclassified job (NULL) is treated as direct so the
// legacy pipeline keeps working before the backfill has run. Every picker/list/count query
// interpolates this exact expression (aliases: a = applications, m = matches) so the /queue
// filter, the /apply quota counts and the executor's picker can never disagree.
export const EFFECTIVE_MODE_SQL =
  "COALESCE(a.apply_mode, CASE WHEN m.referral_fit = 1 THEN 'referral' ELSE 'direct' END)";

export const APPLY_MODES = ["referral", "direct"] as const;
export type ApplyMode = (typeof APPLY_MODES)[number];

export function isApplyMode(s: unknown): s is ApplyMode {
  return typeof s === "string" && (APPLY_MODES as readonly string[]).includes(s);
}

// User -> App from /queue's 改为海投 / 改为找内推 / 跟随建议 buttons. null clears the override.
// Only while the job is still sitting in the queue (status='matched'): once it has been taken
// by a batch (prepared / referral_seeking / …) the mode is already committed.
export function setApplyMode(db: DB, jobId: number, mode: ApplyMode | null): void {
  if (mode !== null && !isApplyMode(mode)) {
    throw new Error(`setApplyMode: invalid mode '${String(mode)}' (must be referral, direct or null)`);
  }
  const row = db.prepare("SELECT status FROM applications WHERE job_id = ?").get(jobId) as { status: string } | undefined;
  if (!row) throw new Error(`setApplyMode: no application for job ${jobId}`);
  if (row.status !== "matched") {
    throw new Error(`setApplyMode: cannot change mode from status '${row.status}' (must be 'matched')`);
  }
  db.prepare("UPDATE applications SET apply_mode = ? WHERE job_id = ?").run(mode, jobId);
}

export function effectiveMode(db: DB, jobId: number): ApplyMode {
  const row = db
    .prepare(
      `SELECT ${EFFECTIVE_MODE_SQL} AS mode FROM applications a JOIN matches m ON m.job_id = a.job_id WHERE a.job_id = ?`
    )
    .get(jobId) as { mode: string } | undefined;
  if (!row) throw new Error(`effectiveMode: no application+match for job ${jobId}`);
  return row.mode as ApplyMode;
}
