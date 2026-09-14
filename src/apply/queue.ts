import { DB } from "@/lib/db";
import { QUEUE_ORDER_SQL } from "@/apply/rank";
import { Profile } from "@/lib/profile";
import { buildAnswerPack, AnswerPack, AnswerPackReferral } from "@/apply/answers";
import { EFFECTIVE_MODE_SQL, ApplyMode } from "@/apply/mode";
import { selectResumeForJob } from "@/apply/resume-select";
import { applyEligibility, Sponsorship, DegreeReq, RoleKind } from "@/apply/eligibility";

// 队列/取数的统一资格过滤(spec 2026-09-03 §3)。以 `j` 为 jobs 别名。所有"用户会看到 / 执行器会取到"
// 的查询都必须带上它,否则重复行或被判不合格的岗会从某个入口漏回来。
export const QUEUE_ELIGIBLE_SQL =
  "j.loc_flag IS NULL AND j.visa_flag IS NULL AND j.duplicate_of IS NULL" +
  " AND COALESCE(j.sponsorship,'') <> 'no'" +
  " AND COALESCE(j.degree_req,'') <> 'phd_only'" +
  " AND COALESCE(j.role_kind,'') <> 'non_tech'";

// Tenancy (spec 2026-09-13 accounts §3): applications and matches are per account — one row per
// (user, job). Every query here takes the acting user's id and joins matches on the same user
// (`m.user_id = a.user_id`), so two accounts' scores for the same posting never mix.

// The apply-executor protocol: the App is the "brain" (this file's pure DB logic) and a
// Claude-in-Chrome session is the "hands" (drives the user's real, logged-in Chrome per
// .claude/skills/apply-executor). Both sides only ever talk through localhost API + SQLite.
//
// State machine on applications.status:
//   matched -> prepared -> awaiting_confirm -> submitted
// with `needs_manual_reason` acting as a "parked" flag: a matched-but-parked application is
// skipped by the picker (see the `needs_manual_reason IS NULL` filter below) until a human
// clears the reason, so it never gets re-offered in a tight loop. reportFill's needs_manual/error
// outcomes, and decide's reject outcome, all return status to 'matched' *with* a reason set —
// same parking mechanism, different callers.

export interface ApplyTask {
  jobId: number;
  company: string;
  title: string;
  applyUrl: string;
  ats: string | null;
  answerPack: AnswerPack;
}

interface CandidateRow {
  job_id: number;
  company: string;
  title: string;
  apply_url: string | null;
  ats: string | null;
  referral_info: string | null;
  referral_person_name: string | null;
}

// applications.referral_info is JSON written by referralDecide('won'); tolerate a corrupt value
// (undefined → no referral section) rather than failing the whole pick.
export function parseReferral(json: string | null, personName: string | null): AnswerPackReferral | undefined {
  if (!json) return undefined;
  try {
    const o = JSON.parse(json) as { source?: string; link?: string; code?: string; note?: string };
    return {
      source: o.source ?? "other",
      person_name: personName ?? "",
      link: o.link ?? "",
      code: o.code ?? "",
      note: o.note ?? "",
    };
  } catch {
    return undefined;
  }
}

// Picks the single highest-priority open application and prepares it for the executor:
// selects a resume, builds the answer pack, and advances matched -> prepared so a second call
// (or a concurrent executor) skips it. Jobs whose direction has no generated resume are parked
// (needs_manual_reason set, status left at 'matched') and the loop moves on to the next
// candidate — they never get returned to the caller as a task.
export function takeNextApplication(
  db: DB,
  userId: string,
  profile: Profile,
  opts: { direction?: string; jobIds?: number[] } = {}
): ApplyTask | { done: true } {
  // Reclaim jobs stranded at 'prepared' by an executor that died mid-fill (crashed session,
  // killed process, network partition — anything that took a task and never reported back).
  // Without this they're invisible forever: 'prepared' fails the picker's 'matched' filter below,
  // and nothing else ever moves them. 30 minutes is generously past any real fill+report round
  // trip, so a still-fresh 'prepared' row (a live executor genuinely mid-fill) is left alone.
  db.prepare(
    "UPDATE applications SET status = 'matched' WHERE user_id = ? AND status = 'prepared' AND updated_at < datetime('now', '-30 minutes')"
  ).run(userId);

  for (;;) {
    // Two ways in. Batch mode (opts.direction optional): the classic picker, now restricted to
    // jobs whose *effective* apply mode is 'direct' — a job Claude tagged 建议内推 (or the user
    // flipped to 找内推) is the referral pipeline's business (src/apply/referral.ts) and must never
    // be filled blind by a direct batch. Targeted mode (opts.jobIds): the 内推进行中 board's
    // 直接投 / 有内推 buttons enqueue a run for specific jobs; those may be 'referral_ready' (a
    // referral was obtained) and their mode is irrelevant — the user explicitly asked.
    // a.pinned DESC leads every ORDER BY here: a row the user starred on /queue ("置顶/优先")
    // must be the very next thing the executor takes, ahead of tier/score/freshness.
    const targeted = !!(opts.jobIds && opts.jobIds.length > 0);
    const where = targeted
      ? `a.status IN ('matched','referral_ready') AND a.needs_manual_reason IS NULL AND j.loc_flag IS NULL
         AND a.job_id IN (${opts.jobIds!.map(() => "?").join(",")})`
      : `a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
         AND ${EFFECTIVE_MODE_SQL} = 'direct'${opts.direction ? " AND m.direction = ?" : ""}`;
    const params: unknown[] = targeted ? [...opts.jobIds!] : opts.direction ? [opts.direction] : [];
    const row = db
      .prepare(
        `SELECT j.id as job_id, j.company, j.title, j.apply_url, j.ats, a.referral_info, p.name as referral_person_name
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
         LEFT JOIN people p ON p.id = a.referral_person_id
         WHERE a.user_id = ? AND ${where}
         ORDER BY a.pinned DESC, ${QUEUE_ORDER_SQL}
         LIMIT 1`
      )
      .get(userId, ...params) as CandidateRow | undefined;

    if (!row) return { done: true };

    if (!row.apply_url) {
      db.prepare("UPDATE applications SET needs_manual_reason = ? WHERE user_id = ? AND job_id = ?").run("no apply url", userId, row.job_id);
      continue; // parked row now fails the needs_manual_reason IS NULL filter — try the next one.
    }

    const selection = selectResumeForJob(db, userId, row.job_id);
    if ("error" in selection) {
      const reason =
        selection.direction != null
          ? `no resume generated for direction '${selection.direction}'`
          : "job has no matched direction";
      db.prepare("UPDATE applications SET needs_manual_reason = ? WHERE user_id = ? AND job_id = ?").run(reason, userId, row.job_id);
      continue; // parked row now fails the needs_manual_reason IS NULL filter — try the next one.
    }

    const answerPack = buildAnswerPack(
      profile,
      { company: row.company, title: row.title, apply_url: row.apply_url },
      { version_name: selection.versionName, pdf_path: selection.pdfPath },
      parseReferral(row.referral_info, row.referral_person_name)
    );
    // Answers the user gave in-App for THIS job earlier (the 待补信息 flow, "仅本次" ones in
    // particular — remembered ones already live in profile.standard_answers) ride along in
    // custom, so a re-take after a timeout/reclaim doesn't ask the same questions again.
    const prior = db.prepare("SELECT info_answers FROM applications WHERE user_id = ? AND job_id = ?").get(userId, row.job_id) as
      | { info_answers: string | null }
      | undefined;
    if (prior?.info_answers) {
      try {
        Object.assign(answerPack.custom, JSON.parse(prior.info_answers));
      } catch {
        // corrupt JSON — ignore, the profile answers alone are still a valid pack
      }
    }

    // confirm_decision reset to NULL defensively: a previous cycle through this same job_id could
    // in principle have left a stale 'rejected'/'approved' behind it; a freshly prepared task must
    // never inherit an old decision. .changes === 0 means another caller already moved this row
    // out of 'matched' between the SELECT above and this UPDATE (e.g. a concurrent executor
    // request) — treat that as a lost race and just try the next candidate rather than returning
    // a task nobody actually locked.
    const claim = db
      .prepare(
        "UPDATE applications SET status = 'prepared', answer_pack = ?, confirm_decision = NULL WHERE user_id = ? AND job_id = ? AND status IN ('matched','referral_ready')"
      )
      .run(JSON.stringify(answerPack), userId, row.job_id);
    if (claim.changes === 0) continue;

    return {
      jobId: row.job_id,
      company: row.company,
      title: row.title,
      applyUrl: row.apply_url ?? "",
      ats: row.ats,
      answerPack,
    };
  }
}

export interface InfoQuestion {
  key: string; // standard_answers key the answer is stored under (e.g. "high_school")
  label: string; // the question as the form words it
  hint?: string; // anything that helps the user answer (e.g. "表单定义 Summer = April–July")
  options?: string[]; // exact option texts when the form is a select
  optional?: boolean; // the form doesn't require it (e.g. an optional essay) — the user may leave it blank to skip
}

export interface ReportFillInput {
  jobId: number;
  status: "awaiting_confirm" | "needs_manual" | "needs_info" | "error";
  // needs_info only: what the executor needs from the user before it can finish this form. The
  // App stores them, notifies the user, and the executor polls /api/apply/pending?jobId= until
  // the user has answered on /apply (status back to 'prepared', answers in infoAnswers).
  questions?: InfoQuestion[];
  // Typed as Record<string, string> for the happy path, but this arrives over HTTP as
  // unvalidated JSON — see coerceFieldValue below for why the runtime doesn't trust the type.
  filledFields?: Record<string, string>;
  reason?: string;
  // Live-page eligibility read by the executor while it was on the job's actual apply page —
  // stronger evidence than anything the match/jd_review passes saw (see SOURCE_RANK in
  // @/apply/eligibility). When this is present and disqualifying, reportFill archives the job
  // and its duplicate cluster instead of parking it in the needs-manual list.
  eligibility?: { sponsorship?: Sponsorship; degree?: DegreeReq; role?: RoleKind; evidence?: string };
  // needs_manual only. true = the live page proved the job is a hard no (explicit no-sponsorship,
  // PhD-only, citizens-only, ...): archive it outright instead of parking it for a human, and
  // archive every other still-queued application with the same company+title so a duplicated
  // listing (the DB has 3 identical Google rows, for instance) isn't offered right back.
  archive?: boolean;
}

// The confirm queue UI renders filledFields values directly as React children. An executor
// report is unvalidated JSON off the wire — a read-back that happens to be an array/number/object
// (e.g. a multi-select control read back as a list) would otherwise crash the whole approval UI
// the moment that row renders. Coerce anything non-string to its JSON representation so persisted
// filled_fields is always safe to render as plain text.
function coerceFieldValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Executor -> App status report. Only 'prepared' may transition; 'awaiting_confirm' is also
// accepted as a from-state so a retried/duplicate report is idempotent rather than a hard error.
export function reportFill(db: DB, userId: string, input: ReportFillInput): void {
  const row = db.prepare("SELECT status FROM applications WHERE user_id = ? AND job_id = ?").get(userId, input.jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`reportFill: no application for job ${input.jobId}`);
  if (row.status !== "prepared" && row.status !== "awaiting_confirm" && row.status !== "needs_info") {
    throw new Error(`reportFill: cannot report from status '${row.status}' (must be 'prepared', 'needs_info' or 'awaiting_confirm')`);
  }

  if (input.status === "needs_info") {
    const questions = (input.questions ?? []).filter((q) => q && typeof q.key === "string" && q.key.trim() && typeof q.label === "string");
    if (questions.length === 0) throw new Error("reportFill: needs_info requires at least one question with key+label");
    db.prepare("UPDATE applications SET status = 'needs_info', pending_questions = ? WHERE user_id = ? AND job_id = ?").run(
      JSON.stringify(questions),
      userId,
      input.jobId
    );
    return;
  }

  if (input.status === "awaiting_confirm") {
    const coerced: Record<string, string> = {};
    for (const [field, value] of Object.entries(input.filledFields ?? {})) {
      coerced[field] = coerceFieldValue(value);
    }
    // RED LINE: this also resets confirm_decision to NULL even when re-reporting from an already
    // approved awaiting_confirm row — a re-fill (e.g. the executor found the tab had reloaded and
    // re-typed everything, see the skill's pre-submit re-verify step) must void any prior
    // approval rather than let a stale 'approved' silently authorize a submit of different data.
    db.prepare(
      "UPDATE applications SET filled_fields = ?, status = 'awaiting_confirm', confirm_decision = NULL WHERE user_id = ? AND job_id = ?"
    ).run(JSON.stringify(coerced), userId, input.jobId);
    return;
  }

  // needs_manual carrying a live-page eligibility read: apply it before parking. A disqualifying
  // read (no sponsorship / phd_only / non_tech) archives this job and its whole duplicate cluster
  // via applyEligibility -> archiveCluster, which also covers a 'prepared' row (archive's status
  // IN list includes 'prepared'). respectPinned:false because live-page text is stronger evidence
  // than a user's earlier pin. When it archives, clear needs_manual_reason/confirm_decision so
  // the now-archived row doesn't linger on the needs-manual list.
  if (input.status === "needs_manual" && input.eligibility) {
    const e = input.eligibility;
    const out = applyEligibility(
      db,
      {
        jobId: input.jobId,
        sponsorship: e.sponsorship ?? "unknown",
        degree: e.degree ?? "ms_ok",
        role: e.role ?? "eng",
        source: "executor_live",
        evidence: e.evidence ?? input.reason,
      },
      { respectPinned: false }
    );
    if (out.failReason) {
      db.prepare("UPDATE applications SET needs_manual_reason = NULL, confirm_decision = NULL WHERE user_id = ? AND job_id = ?").run(
        userId,
        input.jobId
      );
      return;
    }
  }

  // needs_manual | error: both park the application back at 'matched' with a reason recorded;
  // 'error' is distinguished only by an "error: " prefix so the confirmation UI/logs can tell
  // "executor gave up cleanly" apart from "something broke".
  const reason = input.status === "error" ? `error: ${input.reason ?? ""}` : input.reason ?? "";
  if (input.status === "needs_manual" && input.archive) {
    archiveWithDuplicates(db, userId, input.jobId, reason);
    return;
  }
  db.prepare("UPDATE applications SET needs_manual_reason = ?, status = 'matched' WHERE user_id = ? AND job_id = ?").run(
    reason,
    userId,
    input.jobId
  );
}

// reportFill's archive path (see ReportFillInput.archive). The duplicate sweep is scoped to
// status='matched' only: a duplicate that is mid-flight (prepared/awaiting_confirm) or already
// submitted is somebody else's business, and company/title matching is case-insensitive because
// the same posting arrives through different sources with different casing.
function archiveWithDuplicates(db: DB, userId: string, jobId: number, reason: string): void {
  const job = db.prepare("SELECT company, title FROM jobs WHERE id = ?").get(jobId) as
    | { company: string; title: string }
    | undefined;
  db.transaction(() => {
    db.prepare("UPDATE applications SET needs_manual_reason = ?, status = 'archived' WHERE user_id = ? AND job_id = ?").run(
      reason,
      userId,
      jobId
    );
    if (!job) return;
    db.prepare(
      `UPDATE applications SET status = 'archived', needs_manual_reason = ?
       WHERE user_id = ? AND status = 'matched'
         AND job_id IN (SELECT id FROM jobs WHERE id <> ? AND company = ? COLLATE NOCASE AND title = ? COLLATE NOCASE)`
    ).run(`duplicate of job ${jobId}: ${reason}`, userId, jobId, job.company, job.title);
  })();
}

// User's decision from the in-app confirmation queue. approve leaves status at
// 'awaiting_confirm' (reportSubmitted is the only thing allowed to move it past that — see the
// red line below); reject parks the application back at 'matched' like a needs_manual report.
export function decide(db: DB, userId: string, jobId: number, decision: "approve" | "reject", reason?: string): void {
  const row = db.prepare("SELECT status FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`decide: no application for job ${jobId}`);
  if (row.status !== "awaiting_confirm") {
    throw new Error(`decide: cannot decide from status '${row.status}' (must be 'awaiting_confirm')`);
  }

  if (decision === "approve") {
    db.prepare("UPDATE applications SET confirm_decision = 'approved' WHERE user_id = ? AND job_id = ?").run(userId, jobId);
    return;
  }

  if (decision === "reject") {
    // Parks the application in the same needs_manual_reason mechanism as an executor's own
    // needs_manual report — the rejected job lands in /apply's 需人工清单 (needs-manual list),
    // it is NOT silently re-offered to the executor on the next takeNextApplication call.
    db.prepare(
      "UPDATE applications SET status = 'matched', confirm_decision = 'rejected', needs_manual_reason = ? WHERE user_id = ? AND job_id = ?"
    ).run(reason ?? "user rejected fill", userId, jobId);
    return;
  }

  throw new Error(`decide: invalid decision '${decision}' (must be 'approve' or 'reject')`);
}

// RED LINE: the only path to status='submitted'. Throws unless the application is sitting at
// awaiting_confirm with an explicit human approval — this is the App-side half of the plan's
// "double lock" (the executor skill's own protocol is the other half: it must not click Submit
// without first polling this same approval).
export function reportSubmitted(db: DB, userId: string, jobId: number): void {
  const row = db.prepare("SELECT status, confirm_decision FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
    | { status: string; confirm_decision: string | null }
    | undefined;
  if (!row || row.status !== "awaiting_confirm" || row.confirm_decision !== "approved") {
    throw new Error(
      `reportSubmitted red line: job ${jobId} is not approved+awaiting_confirm ` +
        `(status=${row?.status ?? "none"}, confirm_decision=${row?.confirm_decision ?? "none"})`
    );
  }
  db.prepare("UPDATE applications SET status = 'submitted', submitted_at = datetime('now') WHERE user_id = ? AND job_id = ?").run(userId, jobId);
}

export interface PendingRow {
  jobId: number;
  company: string;
  title: string;
  direction: string | null;
  tier: number | null;
  score: number | null;
  filledFields: Record<string, string>;
  resumeVersion: string | null;
  // NULL until the user acts; 'approved' means "the executor is waiting to submit this" — the UI
  // must not offer the same card for approve/reject a second time once this is 'approved'.
  decision: string | null;
  // Set when this application is linked to the outreach/person that produced it (§7.4
  // bidirectional link — written by network/gate.ts's recordOutcome on a 'referral_won'
  // outcome). Lets the /apply confirm card show "带内推 · <name>" instead of silently deciding
  // for the user that this was a cold application.
  referralPersonName: string | null;
}

interface PendingRawRow {
  job_id: number;
  company: string;
  title: string;
  direction: string | null;
  tier: number | null;
  score: number | null;
  filled_fields: string | null;
  answer_pack: string | null;
  confirm_decision: string | null;
  referral_person_name: string | null;
}

// The in-app confirmation queue's data source, and what the executor polls for job-by-job
// status. filled_fields (the reviewable "what got typed where" table) and the resume version
// used are parsed out of their JSON columns here so callers don't need to know the storage shape.
export function pendingConfirmations(db: DB, userId: string): PendingRow[] {
  const rows = db
    .prepare(
      `SELECT j.id as job_id, j.company, j.title, m.direction, m.tier, m.score, a.filled_fields, a.answer_pack,
              a.confirm_decision, p.name as referral_person_name
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
       LEFT JOIN people p ON p.id = a.referral_person_id
       WHERE a.user_id = ? AND a.status = 'awaiting_confirm'
       ORDER BY ${QUEUE_ORDER_SQL}`
    )
    .all(userId) as PendingRawRow[];

  return rows.map((r) => {
    let filledFields: Record<string, string> = {};
    try {
      filledFields = r.filled_fields ? JSON.parse(r.filled_fields) : {};
    } catch {
      filledFields = {};
    }
    let resumeVersion: string | null = null;
    try {
      resumeVersion = r.answer_pack ? JSON.parse(r.answer_pack)?.resume?.version_name ?? null : null;
    } catch {
      resumeVersion = null;
    }
    return {
      jobId: r.job_id,
      company: r.company,
      title: r.title,
      direction: r.direction,
      tier: r.tier,
      score: r.score,
      filledFields,
      resumeVersion,
      decision: r.confirm_decision,
      referralPersonName: r.referral_person_name,
    };
  });
}

// Re-fetches a prepared/awaiting_confirm application's task shape (same shape takeNextApplication
// returns) from its already-stored answer_pack, WITHOUT taking a new job off the queue or
// mutating status. Used by the executor's resume mode (buildApplyPrompt's resume section, via
// GET /api/apply/task?jobId=) to re-open and re-fill an application that a prior executor
// process left approved+awaiting_confirm but never got to submit — the task data (applyUrl,
// answerPack with the resume pdf_path, ats) is identical to what the original takeNextApplication
// call handed out; only the fresh confirm_decision (reset by reportFill) differs.
export function getApplyTask(db: DB, userId: string, jobId: number): ApplyTask | { error: string } {
  const row = db
    .prepare(
      `SELECT j.company, j.title, j.apply_url, j.ats, a.answer_pack, a.status
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = ? AND a.job_id = ?`
    )
    .get(userId, jobId) as
    | { company: string; title: string; apply_url: string | null; ats: string | null; answer_pack: string | null; status: string }
    | undefined;

  if (!row) return { error: `getApplyTask: no application for job ${jobId}` };
  if (row.status !== "prepared" && row.status !== "awaiting_confirm") {
    return {
      error: `getApplyTask: job ${jobId} is not prepared/awaiting_confirm (status='${row.status}')`,
    };
  }
  if (!row.answer_pack) {
    return { error: `getApplyTask: job ${jobId} has no stored answer_pack` };
  }

  let answerPack: AnswerPack;
  try {
    answerPack = JSON.parse(row.answer_pack);
  } catch {
    return { error: `getApplyTask: job ${jobId} has a corrupt stored answer_pack` };
  }

  return {
    jobId,
    company: row.company,
    title: row.title,
    applyUrl: row.apply_url ?? "",
    ats: row.ats,
    answerPack,
  };
}

// The executor's per-job poll. Besides the approval decision it carries infoAnswers — the
// answers the user gave on /apply for this job (待补信息 flow) — so an executor waiting at
// 'needs_info' sees status flip back to 'prepared' and gets the answers in the same response.
export function confirmStatus(
  db: DB,
  userId: string,
  jobId: number
): { decision: string | null; status: string; infoAnswers: Record<string, string> | null } {
  const row = db.prepare("SELECT status, confirm_decision, info_answers FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
    | { status: string; confirm_decision: string | null; info_answers: string | null }
    | undefined;
  if (!row) throw new Error(`confirmStatus: no application for job ${jobId}`);
  let infoAnswers: Record<string, string> | null = null;
  if (row.info_answers) {
    try {
      infoAnswers = JSON.parse(row.info_answers);
    } catch {
      infoAnswers = null;
    }
  }
  return { decision: row.confirm_decision, status: row.status, infoAnswers };
}

// Clears a parked application's needs_manual_reason so it re-enters takeNextApplication's pool —
// e.g. the job was parked for "no resume generated for direction 'quant'" and the user has since
// gone to Studio and generated one. Only valid from status='matched'; anything else (submitted,
// still awaiting_confirm, etc.) has nothing meaningful to "retry".
export function unpark(db: DB, userId: string, jobId: number): void {
  const row = db.prepare("SELECT status FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`unpark: no application for job ${jobId}`);
  if (row.status !== "matched") {
    throw new Error(`unpark: cannot unpark from status '${row.status}' (must be 'matched')`);
  }
  db.prepare("UPDATE applications SET needs_manual_reason = NULL WHERE user_id = ? AND job_id = ?").run(userId, jobId);
}

// Sentinel used wherever a NULL matches.direction needs a display/routing string — the
// queueByDirection summary and the /queue tab strip it feeds, and pagedQueue's own direction
// filter below (which maps this string back to "IS NULL" rather than a literal match).
import { ALL_JOBS_DIRECTION, UNCLASSIFIED_DIRECTION } from "@/app/lib/queue-const";
export { ALL_JOBS_DIRECTION, UNCLASSIFIED_DIRECTION };

export interface DirectionQueueRow {
  score: number;
  company: string;
  title: string;
}

export interface DirectionQueueGroup {
  direction: string;
  tier: number | null;
  matched: number;
  // Split of `matched` by effective apply mode (EFFECTIVE_MODE_SQL) — the /apply quota table's
  // 找内推 / 海投 columns draw from these two pools.
  referralSuggested: number;
  directSuggested: number;
  top: DirectionQueueRow[];
}

interface DirectionGroupRawRow {
  direction: string | null;
  tier: number | null;
  matched: number;
  referral_suggested: number;
  direct_suggested: number;
}

interface TopRawRow {
  direction: string | null;
  score: number;
  company: string;
  title: string;
}

// The apply queue's per-direction summary — feeds /queue's grouped panels and /apply's
// per-direction quota table. Same eligibility filter as takeNextApplication's undirected picker
// (status='matched', not parked, not loc-flagged) so the "队列中" count shown to the user matches
// what the picker can actually offer. NULL direction (unmatched/unscored jobs that somehow
// reached 'matched') is bucketed as "未分类" and always sorts last.
export function queueByDirection(db: DB, userId: string): DirectionQueueGroup[] {
  const groups = db
    .prepare(
      `SELECT m.direction as direction, MIN(m.tier) as tier, COUNT(*) as matched,
              SUM(CASE WHEN ${EFFECTIVE_MODE_SQL} = 'referral' THEN 1 ELSE 0 END) as referral_suggested,
              SUM(CASE WHEN ${EFFECTIVE_MODE_SQL} = 'direct' THEN 1 ELSE 0 END) as direct_suggested
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
       WHERE a.user_id = ? AND a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
       GROUP BY m.direction
       ORDER BY COALESCE(m.tier, 9) ASC, COUNT(*) DESC`
    )
    .all(userId) as DirectionGroupRawRow[];

  if (groups.length === 0) return [];

  const topRows = db
    .prepare(
      `SELECT m.direction as direction, m.score as score, j.company as company, j.title as title
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
       WHERE a.user_id = ? AND a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
       ORDER BY m.score DESC, j.created_at DESC`
    )
    .all(userId) as TopRawRow[];

  const topByDirection = new Map<string | null, DirectionQueueRow[]>();
  for (const r of topRows) {
    const key = r.direction;
    const list = topByDirection.get(key) ?? [];
    if (list.length < 3) {
      list.push({ score: r.score, company: r.company, title: r.title });
      topByDirection.set(key, list);
    }
  }

  // NULL-direction group is re-sorted to the end regardless of its tier/count — it has no real
  // tier (COALESCE'd to 9 like everything untiered) so it can otherwise land ahead of a
  // low-matched-count but genuinely-directed group on a count tiebreak.
  const ordered = [...groups].sort((a, b) => {
    if (a.direction === null && b.direction !== null) return 1;
    if (a.direction !== null && b.direction === null) return -1;
    return 0; // stable: SQL ORDER BY above already sorted everything else correctly.
  });

  return ordered.map((g) => ({
    direction: g.direction ?? UNCLASSIFIED_DIRECTION,
    tier: g.tier,
    matched: g.matched,
    referralSuggested: g.referral_suggested,
    directSuggested: g.direct_suggested,
    top: topByDirection.get(g.direction) ?? [],
  }));
}

// User -> App from the interactive /queue page's row-level "跳过/归档" action. Only valid from
// 'matched' (the same set the picker draws from) — parks the row at status='archived' with a
// fixed, greppable reason so it's obviously a manual skip rather than an executor failure. The
// row simply disappears from every 'matched'-filtered query (queue lists, the picker, quota
// counts) without deleting any data — unarchive() below is the exact inverse.
export function archiveFromQueue(db: DB, userId: string, jobId: number): void {
  const row = db.prepare("SELECT status FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`archiveFromQueue: no application for job ${jobId}`);
  if (row.status !== "matched") {
    throw new Error(`archiveFromQueue: cannot archive from status '${row.status}' (must be 'matched')`);
  }
  db.prepare("UPDATE applications SET status = 'archived', needs_manual_reason = ? WHERE user_id = ? AND job_id = ?").run(
    "user skipped from queue",
    userId,
    jobId
  );
}

// The "撤销" (undo) side of archiveFromQueue — only valid from 'archived', restores 'matched'
// and clears the reason so the row re-enters the picker's pool exactly as it was before.
export function unarchive(db: DB, userId: string, jobId: number): void {
  const row = db.prepare("SELECT status FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`unarchive: no application for job ${jobId}`);
  if (row.status !== "archived") {
    throw new Error(`unarchive: cannot unarchive from status '${row.status}' (must be 'archived')`);
  }
  db.prepare("UPDATE applications SET status = 'matched', needs_manual_reason = NULL WHERE user_id = ? AND job_id = ?").run(userId, jobId);
}

// User -> App from /queue's ★ "置顶/优先" toggle. Not restricted to any particular status — a
// user may star a row before or after it moves through the pipeline — it just flips the flag
// that takeNextApplication and pagedQueue both sort on first.
export function setPinned(db: DB, userId: string, jobId: number, pinned: boolean): void {
  const result = db.prepare("UPDATE applications SET pinned = ? WHERE user_id = ? AND job_id = ?").run(pinned ? 1 : 0, userId, jobId);
  if (result.changes === 0) throw new Error(`setPinned: no application for job ${jobId}`);
}

export type QueueSort = "composite" | "score" | "fresh" | "company";

export interface PagedQueueOpts {
  direction: string;
  page: number;
  pageSize: number;
  sort: QueueSort;
  // /queue's 全部/建议内推/海投 filter — by *effective* mode (override, else suggestion).
  mode?: ApplyMode;
  // Free-text search: company or title contains q (case-insensitive). Blank = no filter.
  q?: string;
}

export interface PagedQueueRow {
  id: number;
  company: string;
  title: string;
  location: string | null;
  apply_url: string | null;
  direction: string | null;
  score: number | null;
  tier: number | null;
  reason: string | null;
  posted_at: string | null;
  pinned: number;
  dup_count: number;
  jd_status: string | null;
  referral_fit: number | null;      // Claude's suggestion (NULL = not classified yet)
  apply_mode: string | null;        // user override, if any
  effective_mode: "referral" | "direct";
  referral_reason: string | null;
}

export interface PagedQueueResult {
  rows: PagedQueueRow[];
  total: number;
  pages: number;
}

// The interactive /queue page's data source for a single direction tab: same eligibility filter
// as queueByDirection/takeNextApplication's undirected picker (status='matched', not parked, not
// loc-flagged), scoped to one direction, with pinned rows always first (see takeNextApplication's
// a.pinned DESC comment above) and then the user's chosen secondary sort.
// "AND (j.company LIKE ? OR j.title LIKE ?)" plus its two params, or nothing for a blank query.
function searchFilter(q: string | undefined): { sql: string; params: string[] } {
  const term = q?.trim();
  if (!term) return { sql: "", params: [] };
  const like = `%${term}%`;
  return { sql: " AND (j.company LIKE ? OR j.title LIKE ?)", params: [like, like] };
}

export function pagedQueue(db: DB, userId: string, opts: PagedQueueOpts): PagedQueueResult {
  // UNCLASSIFIED_DIRECTION is a display sentinel for a NULL matches.direction (see
  // queueByDirection) — it never appears as an actual column value, so the filter below must
  // become "IS NULL" rather than a literal string match, or the 未分类 tab would always be empty.
  const directionFilter = opts.direction === UNCLASSIFIED_DIRECTION ? "m.direction IS NULL" : "m.direction = ?";
  const directionParams: unknown[] = opts.direction === UNCLASSIFIED_DIRECTION ? [] : [opts.direction];
  const modeFilter = opts.mode ? ` AND ${EFFECTIVE_MODE_SQL} = ?` : "";
  if (opts.mode) directionParams.push(opts.mode);
  const search = searchFilter(opts.q);
  directionParams.push(...search.params);

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) n
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
         WHERE a.user_id = ? AND a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
           AND ${directionFilter}${modeFilter}${search.sql}`
      )
      .get(userId, ...directionParams) as { n: number }
  ).n;

  const pages = total === 0 ? 1 : Math.max(1, Math.ceil(total / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), pages);
  const offset = (page - 1) * opts.pageSize;

  const secondarySort =
    opts.sort === "company"
      ? "j.company COLLATE NOCASE ASC, j.title ASC"
      : opts.sort === "fresh"
      ? "(j.posted_at IS NULL) ASC, j.posted_at DESC, j.created_at DESC"
      : opts.sort === "score"
      ? "COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC"
      : QUEUE_ORDER_SQL; // composite(默认):方向优先级 → 综合分(分数减时间惩罚)→ 原始分

  const rows = db
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.apply_url, m.direction, m.score, m.tier, m.reason,
              j.posted_at, a.pinned,
              j.jd_status,
              (SELECT COUNT(*) FROM jobs d WHERE d.duplicate_of = j.id) AS dup_count,
              m.referral_fit, a.apply_mode, ${EFFECTIVE_MODE_SQL} AS effective_mode, m.referral_reason
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
       WHERE a.user_id = ? AND a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
         AND ${directionFilter}${modeFilter}${search.sql}
       ORDER BY a.pinned DESC, ${secondarySort}
       LIMIT ? OFFSET ?`
    )
    .all(userId, ...directionParams, opts.pageSize, offset) as PagedQueueRow[];

  return { rows, total, pages };
}

// ALL_JOBS_DIRECTION (the merged /queue page's "全部入库" tab — every visa/US visible job, scored or
// not, queued or not) and UNCLASSIFIED_DIRECTION are defined in src/app/lib/queue-const.ts so the
// client can import them without this module; both are routing keys only.

export interface PagedAllJobsRow extends PagedQueueRow {
  source: string;
  created_at: string;
  // 1 when the job is currently in the apply queue (matched, not parked) — the row-level
  // pin/skip actions only make sense for those; raw scanner output has no applications row.
  in_queue: number;
}

export interface PagedAllJobsResult {
  rows: PagedAllJobsRow[];
  total: number;
  pages: number;
}

// The population of the old /jobs page (visa_flag IS NULL AND loc_flag IS NULL), served in the
// same paged/sorted shape as pagedQueue so the /queue board can render both from one table.
// matches/applications are LEFT JOINed (on this user's rows): an unscored job still shows up
// with score NULL.
export function pagedAllJobs(db: DB, userId: string, opts: Omit<PagedQueueOpts, "direction">): PagedAllJobsResult {
  const search = searchFilter(opts.q);
  const where = `j.visa_flag IS NULL AND j.loc_flag IS NULL${search.sql}`;
  const total = (db.prepare(`SELECT COUNT(*) n FROM jobs j WHERE ${where}`).get(...search.params) as { n: number }).n;

  const pages = total === 0 ? 1 : Math.max(1, Math.ceil(total / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), pages);
  const offset = (page - 1) * opts.pageSize;

  // "fresh" here means scan time (created_at), not posted_at — it mirrors the old /jobs listing,
  // whose whole point was "what did the last scan bring in".
  const orderBy =
    opts.sort === "company"
      ? "j.company COLLATE NOCASE ASC, j.title ASC"
      : opts.sort === "fresh"
      ? "j.created_at DESC, j.id DESC"
      : "(m.score IS NULL) ASC, COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC";

  const rows = db
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.apply_url, j.source, j.created_at,
              m.direction, m.score, m.tier, m.reason, j.posted_at,
              COALESCE(a.pinned, 0) AS pinned,
              m.referral_fit, a.apply_mode, ${EFFECTIVE_MODE_SQL} AS effective_mode, m.referral_reason,
              CASE WHEN a.status = 'matched' AND a.needs_manual_reason IS NULL THEN 1 ELSE 0 END AS in_queue
       FROM jobs j
       LEFT JOIN matches m ON m.job_id = j.id AND m.user_id = ?
       LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = ?
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(userId, userId, ...search.params, opts.pageSize, offset) as PagedAllJobsRow[];

  return { rows, total, pages };
}
