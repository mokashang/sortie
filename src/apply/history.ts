import { DB, logEvent } from "@/lib/db";

// The post-submit half of the application lifecycle, owned by the /history page ("投递历史"):
// everything that has actually been sent out (status reached 'submitted') and where it is now.
// Pre-submit states (matched/prepared/awaiting_confirm, and the needs_manual parking flag) stay
// in src/apply/queue.ts — this module never touches them except archiveManual, which is the
// "remove from the needs-manual list" action and deliberately lives next to the other
// user-facing status moves.
//
// Time handling: applications.submitted_at / updated_at are sqlite `datetime('now')` — UTC with
// no marker. Every query here converts with sqlite's 'localtime' modifier so "today" and the
// day-grouping headers follow the server's wall clock (the user's own day), not the UTC day.

import {
  POST_SUBMIT_STAGES,
  PostSubmitStage,
  PeakStage,
  isPostSubmitStage,
  peakOf,
  isRung,
  HistoryRow,
} from "@/apply/stages";
export { POST_SUBMIT_STAGES, STAGE_LABELS } from "@/apply/stages";
export type { PostSubmitStage, PeakStage, HistoryRow } from "@/apply/stages";

// User -> App from /history's per-row status selector. Any post-submit stage may move to any
// other post-submit stage (including backwards — a mis-click must be undoable without a special
// path), but a row that never reached 'submitted' can't be dragged into this lifecycle: the
// executor/confirm flow is the only way in (reportSubmitted, src/apply/queue.ts). Each move is
// logged as an 'application_stage' event so the row has an auditable timeline.
export function setStage(db: DB, userId: string, jobId: number, stage: string, note?: string | null): void {
  if (!isPostSubmitStage(stage)) {
    throw new Error(`setStage: invalid stage '${stage}' (must be one of ${POST_SUBMIT_STAGES.join(", ")})`);
  }
  const row = db.prepare("SELECT status FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`setStage: no application for job ${jobId}`);
  if (!isPostSubmitStage(row.status)) {
    throw new Error(`setStage: job ${jobId} has not been submitted (status='${row.status}')`);
  }
  db.prepare("UPDATE applications SET status = ? WHERE user_id = ? AND job_id = ?").run(stage, userId, jobId);
  logEvent(db, "application_stage", {
    userId,
    entity: "application",
    entityId: jobId,
    payload: { from: row.status, to: stage, note: note?.trim() ? note.trim() : null },
  });
}

interface HistoryRawRow {
  job_id: number;
  company: string;
  title: string;
  apply_url: string | null;
  direction: string | null;
  status: string;
  submitted_at: string;
  submitted_day: string;
  updated_at: string;
  answer_pack: string | null;
  last_note: string | null;
  stage_path: string | null; // JSON array of every 'to' in this row's application_stage events
  apply_mode: "referral" | "direct";
  referral_person_name: string | null;
}

const STAGE_IN = `(${POST_SUBMIT_STAGES.map((s) => `'${s}'`).join(",")})`;

// How the application was submitted: with a referral (referralDecide 'won' wrote referral_info,
// or network/gate's recordOutcome stamped referral_person_id) or cold.
const APPLY_MODE_SQL =
  "CASE WHEN a.referral_info IS NOT NULL OR a.referral_person_id IS NOT NULL THEN 'referral' ELSE 'direct' END";

// Stage events are keyed by (user, job): the same posting can be in two accounts' histories.
// Events written before accounts have user_id = the claiming owner (claimLegacyData), so the
// user filter holds for old rows too.
const STAGE_EVENTS_FOR_ROW = "e.kind = 'application_stage' AND e.entity_id = a.job_id AND e.user_id = a.user_id";

// /history's data source: every application that has been submitted, newest submission first.
// The page groups these client-side by direction tab and by submittedDay.
export function applicationHistory(db: DB, userId: string): HistoryRow[] {
  const rows = db
    .prepare(
      `SELECT a.job_id, j.company, j.title, j.apply_url, m.direction, a.status,
              strftime('%Y-%m-%d %H:%M', a.submitted_at, 'localtime') as submitted_at,
              strftime('%Y-%m-%d', a.submitted_at, 'localtime') as submitted_day,
              strftime('%Y-%m-%d %H:%M', a.updated_at, 'localtime') as updated_at,
              a.answer_pack,
              ${APPLY_MODE_SQL} as apply_mode, p.name as referral_person_name,
              (SELECT json_extract(e.payload, '$.note') FROM events e
                 WHERE ${STAGE_EVENTS_FOR_ROW}
                   AND json_extract(e.payload, '$.note') IS NOT NULL
                 ORDER BY e.id DESC LIMIT 1) as last_note,
              (SELECT json_group_array(t) FROM (
                 SELECT json_extract(e.payload, '$.to') AS t FROM events e
                 WHERE ${STAGE_EVENTS_FOR_ROW}
                 ORDER BY e.id)) as stage_path
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
       LEFT JOIN people p ON p.id = a.referral_person_id
       WHERE a.user_id = ? AND a.status IN ${STAGE_IN} AND a.submitted_at IS NOT NULL
       ORDER BY a.submitted_at DESC, a.job_id DESC`
    )
    .all(userId) as HistoryRawRow[];

  return rows.map((r) => {
    let resumeVersion: string | null = null;
    try {
      resumeVersion = r.answer_pack ? JSON.parse(r.answer_pack)?.resume?.version_name ?? null : null;
    } catch {
      resumeVersion = null;
    }
    // Peak = the last rung the row stood on, walking the timeline [submitted, ...every 'to'].
    // If the current status is a rung, that's simply the current status — so a backwards move
    // (oa -> submitted) is a correction and the chart follows it. If the current status is an
    // outcome (rejected / stale), the peak is the last rung before it — so "rejected after
    // interview" branches off the interview node. Rows that predate stage events fall back to
    // the current status alone.
    const status = r.status as PostSubmitStage;
    let peak: PeakStage = peakOf(status);
    if (!isRung(status)) {
      try {
        const path: unknown[] = r.stage_path ? JSON.parse(r.stage_path) : [];
        const timeline: PostSubmitStage[] = ["submitted"];
        for (const to of path) if (typeof to === "string" && isPostSubmitStage(to)) timeline.push(to);
        const lastRung = [...timeline].reverse().find(isRung);
        if (lastRung) peak = peakOf(lastRung);
      } catch {
        /* malformed payload: keep the status-derived peak */
      }
    }
    return {
      jobId: r.job_id,
      company: r.company,
      title: r.title,
      applyUrl: r.apply_url,
      direction: r.direction,
      status,
      peak,
      submittedAt: r.submitted_at,
      submittedDay: r.submitted_day,
      updatedAt: r.updated_at,
      resumeVersion,
      lastNote: r.last_note,
      applyMode: r.apply_mode,
      referralPersonName: r.referral_person_name,
    };
  });
}

export interface TodaySubmittedRow {
  jobId: number;
  company: string;
  title: string;
  direction: string | null;
  submittedAt: string; // local "HH:MM"
  applyMode: "referral" | "direct";
  referralPersonName: string | null;
}

// /apply's "今日已提交" strip. "Today" is the server's local calendar day (resets at local
// midnight), and a row counts by *when it was submitted*, not by its current status — one that
// already moved on to oa/interview today is still a submission made today.
export function todaySubmitted(db: DB, userId: string): TodaySubmittedRow[] {
  const rows = db
    .prepare(
      `SELECT a.job_id, j.company, j.title, m.direction,
              strftime('%H:%M', a.submitted_at, 'localtime') as submitted_at,
              ${APPLY_MODE_SQL} as apply_mode, p.name as referral_person_name
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
       LEFT JOIN people p ON p.id = a.referral_person_id
       WHERE a.user_id = ? AND a.status IN ${STAGE_IN}
         AND a.submitted_at IS NOT NULL
         AND date(a.submitted_at, 'localtime') = date('now', 'localtime')
       ORDER BY a.submitted_at DESC`
    )
    .all(userId) as {
    job_id: number;
    company: string;
    title: string;
    direction: string | null;
    submitted_at: string;
    apply_mode: "referral" | "direct";
    referral_person_name: string | null;
  }[];
  return rows.map((r) => ({
    jobId: r.job_id,
    company: r.company,
    title: r.title,
    direction: r.direction,
    submittedAt: r.submitted_at,
    applyMode: r.apply_mode,
    referralPersonName: r.referral_person_name,
  }));
}

export interface ArchiveManualResult {
  archived: number;
  skipped: number[]; // jobIds that were not parked (nothing to remove) or don't exist
}

// User -> App from /apply's 需人工清单 "移除" (single) / "移除所选" (batch). Only a parked row —
// status='matched' with a needs_manual_reason — qualifies; it becomes 'archived' with the reason
// left intact so the audit trail says why it was parked in the first place. Archived rows are
// invisible to the picker, the queue and the quota counts, and unlike a hard DELETE the job
// can't be re-discovered by the next scan and quietly re-enter the queue. /queue's unarchive is
// the exact inverse if one was removed by mistake.
export function archiveManual(db: DB, userId: string, jobIds: number[]): ArchiveManualResult {
  const stmt = db.prepare(
    "UPDATE applications SET status = 'archived' WHERE user_id = ? AND job_id = ? AND status = 'matched' AND needs_manual_reason IS NOT NULL"
  );
  const skipped: number[] = [];
  let archived = 0;
  const run = db.transaction((ids: number[]) => {
    for (const id of ids) {
      if (stmt.run(userId, id).changes === 1) archived++;
      else skipped.push(id);
    }
  });
  run(jobIds);
  return { archived, skipped };
}
