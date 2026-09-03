import { DB } from "@/lib/db";
import { Profile } from "@/lib/profile";
import { buildAnswerPack, AnswerPack } from "@/apply/answers";
import { selectResumeForJob } from "@/apply/resume-select";
import { applyEligibility, Sponsorship, DegreeReq, RoleKind } from "@/apply/eligibility";

// 队列/取数的统一资格过滤(spec 2026-09-03 §3)。以 `j` 为 jobs 别名。所有"用户会看到 / 执行器会取到"
// 的查询都必须带上它,否则重复行或被判不合格的岗会从某个入口漏回来。
export const QUEUE_ELIGIBLE_SQL =
  "j.loc_flag IS NULL AND j.visa_flag IS NULL AND j.duplicate_of IS NULL" +
  " AND COALESCE(j.sponsorship,'') <> 'no'" +
  " AND COALESCE(j.degree_req,'') <> 'phd_only'" +
  " AND COALESCE(j.role_kind,'') <> 'non_tech'";

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
}

// Picks the single highest-priority open application and prepares it for the executor:
// selects a resume, builds the answer pack, and advances matched -> prepared so a second call
// (or a concurrent executor) skips it. Jobs whose direction has no generated resume are parked
// (needs_manual_reason set, status left at 'matched') and the loop moves on to the next
// candidate — they never get returned to the caller as a task.
export function takeNextApplication(
  db: DB,
  profile: Profile,
  opts: { direction?: string } = {}
): ApplyTask | { done: true } {
  // Reclaim jobs stranded at 'prepared' by an executor that died mid-fill (crashed session,
  // killed process, network partition — anything that took a task and never reported back).
  // Without this they're invisible forever: 'prepared' fails the picker's 'matched' filter below,
  // and nothing else ever moves them. 30 minutes is generously past any real fill+report round
  // trip, so a still-fresh 'prepared' row (a live executor genuinely mid-fill) is left alone.
  db.prepare(
    "UPDATE applications SET status = 'matched' WHERE status = 'prepared' AND updated_at < datetime('now', '-30 minutes')"
  ).run();

  for (;;) {
    // opts.direction scopes the picker to a single direction (used by the per-direction apply
    // quota plan — see buildApplyPrompt's `plan` mode) — every other semantic (priority order,
    // parking, stale-prepared reclaim, no-URL park) is identical to the undirected picker.
    // a.pinned DESC leads every ORDER BY here: a row the user starred on /queue ("置顶/优先")
    // must be the very next thing the executor takes, ahead of tier/score/freshness.
    const row = (
      opts.direction
        ? db
            .prepare(
              `SELECT j.id as job_id, j.company, j.title, j.apply_url, j.ats
               FROM applications a
               JOIN jobs j ON j.id = a.job_id
               JOIN matches m ON m.job_id = j.id
               WHERE a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
                 AND m.direction = ?
               ORDER BY a.pinned DESC, COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC
               LIMIT 1`
            )
            .get(opts.direction)
        : db
            .prepare(
              `SELECT j.id as job_id, j.company, j.title, j.apply_url, j.ats
               FROM applications a
               JOIN jobs j ON j.id = a.job_id
               JOIN matches m ON m.job_id = j.id
               WHERE a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
               ORDER BY a.pinned DESC, COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC
               LIMIT 1`
            )
            .get()
    ) as CandidateRow | undefined;

    if (!row) return { done: true };

    if (!row.apply_url) {
      db.prepare("UPDATE applications SET needs_manual_reason = ? WHERE job_id = ?").run("no apply url", row.job_id);
      continue; // parked row now fails the needs_manual_reason IS NULL filter — try the next one.
    }

    const selection = selectResumeForJob(db, row.job_id);
    if ("error" in selection) {
      const reason =
        selection.direction != null
          ? `no resume generated for direction '${selection.direction}'`
          : "job has no matched direction";
      db.prepare("UPDATE applications SET needs_manual_reason = ? WHERE job_id = ?").run(reason, row.job_id);
      continue; // parked row now fails the needs_manual_reason IS NULL filter — try the next one.
    }

    const answerPack = buildAnswerPack(
      profile,
      { company: row.company, title: row.title, apply_url: row.apply_url },
      { version_name: selection.versionName, pdf_path: selection.pdfPath }
    );

    // confirm_decision reset to NULL defensively: a previous cycle through this same job_id could
    // in principle have left a stale 'rejected'/'approved' behind it; a freshly prepared task must
    // never inherit an old decision. .changes === 0 means another caller already moved this row
    // out of 'matched' between the SELECT above and this UPDATE (e.g. a concurrent executor
    // request) — treat that as a lost race and just try the next candidate rather than returning
    // a task nobody actually locked.
    const claim = db
      .prepare(
        "UPDATE applications SET status = 'prepared', answer_pack = ?, confirm_decision = NULL WHERE job_id = ? AND status = 'matched'"
      )
      .run(JSON.stringify(answerPack), row.job_id);
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

export interface ReportFillInput {
  jobId: number;
  status: "awaiting_confirm" | "needs_manual" | "error";
  // Typed as Record<string, string> for the happy path, but this arrives over HTTP as
  // unvalidated JSON — see coerceFieldValue below for why the runtime doesn't trust the type.
  filledFields?: Record<string, string>;
  reason?: string;
  // Live-page eligibility read by the executor while it was on the job's actual apply page —
  // stronger evidence than anything the match/jd_review passes saw (see SOURCE_RANK in
  // @/apply/eligibility). When this is present and disqualifying, reportFill archives the job
  // and its duplicate cluster instead of parking it in the needs-manual list.
  eligibility?: { sponsorship?: Sponsorship; degree?: DegreeReq; role?: RoleKind; evidence?: string };
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
export function reportFill(db: DB, input: ReportFillInput): void {
  const row = db.prepare("SELECT status FROM applications WHERE job_id = ?").get(input.jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`reportFill: no application for job ${input.jobId}`);
  if (row.status !== "prepared" && row.status !== "awaiting_confirm") {
    throw new Error(`reportFill: cannot report from status '${row.status}' (must be 'prepared' or 'awaiting_confirm')`);
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
      "UPDATE applications SET filled_fields = ?, status = 'awaiting_confirm', confirm_decision = NULL WHERE job_id = ?"
    ).run(JSON.stringify(coerced), input.jobId);
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
      db.prepare("UPDATE applications SET needs_manual_reason = NULL, confirm_decision = NULL WHERE job_id = ?").run(
        input.jobId
      );
      return;
    }
  }

  // needs_manual | error: both park the application back at 'matched' with a reason recorded;
  // 'error' is distinguished only by an "error: " prefix so the confirmation UI/logs can tell
  // "executor gave up cleanly" apart from "something broke".
  const reason = input.status === "error" ? `error: ${input.reason ?? ""}` : input.reason ?? "";
  db.prepare("UPDATE applications SET needs_manual_reason = ?, status = 'matched' WHERE job_id = ?").run(
    reason,
    input.jobId
  );
}

// User's decision from the in-app confirmation queue. approve leaves status at
// 'awaiting_confirm' (reportSubmitted is the only thing allowed to move it past that — see the
// red line below); reject parks the application back at 'matched' like a needs_manual report.
export function decide(db: DB, jobId: number, decision: "approve" | "reject", reason?: string): void {
  const row = db.prepare("SELECT status FROM applications WHERE job_id = ?").get(jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`decide: no application for job ${jobId}`);
  if (row.status !== "awaiting_confirm") {
    throw new Error(`decide: cannot decide from status '${row.status}' (must be 'awaiting_confirm')`);
  }

  if (decision === "approve") {
    db.prepare("UPDATE applications SET confirm_decision = 'approved' WHERE job_id = ?").run(jobId);
    return;
  }

  if (decision === "reject") {
    // Parks the application in the same needs_manual_reason mechanism as an executor's own
    // needs_manual report — the rejected job lands in /apply's 需人工清单 (needs-manual list),
    // it is NOT silently re-offered to the executor on the next takeNextApplication call.
    db.prepare(
      "UPDATE applications SET status = 'matched', confirm_decision = 'rejected', needs_manual_reason = ? WHERE job_id = ?"
    ).run(reason ?? "user rejected fill", jobId);
    return;
  }

  throw new Error(`decide: invalid decision '${decision}' (must be 'approve' or 'reject')`);
}

// RED LINE: the only path to status='submitted'. Throws unless the application is sitting at
// awaiting_confirm with an explicit human approval — this is the App-side half of the plan's
// "double lock" (the executor skill's own protocol is the other half: it must not click Submit
// without first polling this same approval).
export function reportSubmitted(db: DB, jobId: number): void {
  const row = db.prepare("SELECT status, confirm_decision FROM applications WHERE job_id = ?").get(jobId) as
    | { status: string; confirm_decision: string | null }
    | undefined;
  if (!row || row.status !== "awaiting_confirm" || row.confirm_decision !== "approved") {
    throw new Error(
      `reportSubmitted red line: job ${jobId} is not approved+awaiting_confirm ` +
        `(status=${row?.status ?? "none"}, confirm_decision=${row?.confirm_decision ?? "none"})`
    );
  }
  db.prepare("UPDATE applications SET status = 'submitted', submitted_at = datetime('now') WHERE job_id = ?").run(jobId);
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
export function pendingConfirmations(db: DB): PendingRow[] {
  const rows = db
    .prepare(
      `SELECT j.id as job_id, j.company, j.title, m.direction, m.tier, m.score, a.filled_fields, a.answer_pack,
              a.confirm_decision, p.name as referral_person_name
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id
       LEFT JOIN people p ON p.id = a.referral_person_id
       WHERE a.status = 'awaiting_confirm'
       ORDER BY COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC`
    )
    .all() as PendingRawRow[];

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
export function getApplyTask(db: DB, jobId: number): ApplyTask | { error: string } {
  const row = db
    .prepare(
      `SELECT j.company, j.title, j.apply_url, j.ats, a.answer_pack, a.status
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.job_id = ?`
    )
    .get(jobId) as
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

export function confirmStatus(db: DB, jobId: number): { decision: string | null; status: string } {
  const row = db.prepare("SELECT status, confirm_decision FROM applications WHERE job_id = ?").get(jobId) as
    | { status: string; confirm_decision: string | null }
    | undefined;
  if (!row) throw new Error(`confirmStatus: no application for job ${jobId}`);
  return { decision: row.confirm_decision, status: row.status };
}

// Clears a parked application's needs_manual_reason so it re-enters takeNextApplication's pool —
// e.g. the job was parked for "no resume generated for direction 'quant'" and the user has since
// gone to Studio and generated one. Only valid from status='matched'; anything else (submitted,
// still awaiting_confirm, etc.) has nothing meaningful to "retry".
export function unpark(db: DB, jobId: number): void {
  const row = db.prepare("SELECT status FROM applications WHERE job_id = ?").get(jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`unpark: no application for job ${jobId}`);
  if (row.status !== "matched") {
    throw new Error(`unpark: cannot unpark from status '${row.status}' (must be 'matched')`);
  }
  db.prepare("UPDATE applications SET needs_manual_reason = NULL WHERE job_id = ?").run(jobId);
}

// Sentinel used wherever a NULL matches.direction needs a display/routing string — the
// queueByDirection summary and the /queue tab strip it feeds, and pagedQueue's own direction
// filter below (which maps this string back to "IS NULL" rather than a literal match).
export const UNCLASSIFIED_DIRECTION = "未分类";

export interface DirectionQueueRow {
  score: number;
  company: string;
  title: string;
}

export interface DirectionQueueGroup {
  direction: string;
  tier: number | null;
  matched: number;
  top: DirectionQueueRow[];
}

interface DirectionGroupRawRow {
  direction: string | null;
  tier: number | null;
  matched: number;
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
export function queueByDirection(db: DB): DirectionQueueGroup[] {
  const groups = db
    .prepare(
      `SELECT m.direction as direction, MIN(m.tier) as tier, COUNT(*) as matched
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
       GROUP BY m.direction
       ORDER BY COALESCE(m.tier, 9) ASC, COUNT(*) DESC`
    )
    .all() as DirectionGroupRawRow[];

  if (groups.length === 0) return [];

  const topRows = db
    .prepare(
      `SELECT m.direction as direction, m.score as score, j.company as company, j.title as title
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
       ORDER BY m.score DESC, j.created_at DESC`
    )
    .all() as TopRawRow[];

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
    top: topByDirection.get(g.direction) ?? [],
  }));
}

// User -> App from the interactive /queue page's row-level "跳过/归档" action. Only valid from
// 'matched' (the same set the picker draws from) — parks the row at status='archived' with a
// fixed, greppable reason so it's obviously a manual skip rather than an executor failure. The
// row simply disappears from every 'matched'-filtered query (queue lists, the picker, quota
// counts) without deleting any data — unarchive() below is the exact inverse.
export function archiveFromQueue(db: DB, jobId: number): void {
  const row = db.prepare("SELECT status FROM applications WHERE job_id = ?").get(jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`archiveFromQueue: no application for job ${jobId}`);
  if (row.status !== "matched") {
    throw new Error(`archiveFromQueue: cannot archive from status '${row.status}' (must be 'matched')`);
  }
  db.prepare("UPDATE applications SET status = 'archived', needs_manual_reason = ? WHERE job_id = ?").run(
    "user skipped from queue",
    jobId
  );
}

// The "撤销" (undo) side of archiveFromQueue — only valid from 'archived', restores 'matched'
// and clears the reason so the row re-enters the picker's pool exactly as it was before.
export function unarchive(db: DB, jobId: number): void {
  const row = db.prepare("SELECT status FROM applications WHERE job_id = ?").get(jobId) as
    | { status: string }
    | undefined;
  if (!row) throw new Error(`unarchive: no application for job ${jobId}`);
  if (row.status !== "archived") {
    throw new Error(`unarchive: cannot unarchive from status '${row.status}' (must be 'archived')`);
  }
  db.prepare("UPDATE applications SET status = 'matched', needs_manual_reason = NULL WHERE job_id = ?").run(jobId);
}

// User -> App from /queue's ★ "置顶/优先" toggle. Not restricted to any particular status — a
// user may star a row before or after it moves through the pipeline — it just flips the flag
// that takeNextApplication and pagedQueue both sort on first.
export function setPinned(db: DB, jobId: number, pinned: boolean): void {
  const result = db.prepare("UPDATE applications SET pinned = ? WHERE job_id = ?").run(pinned ? 1 : 0, jobId);
  if (result.changes === 0) throw new Error(`setPinned: no application for job ${jobId}`);
}

export type QueueSort = "score" | "fresh" | "company";

export interface PagedQueueOpts {
  direction: string;
  page: number;
  pageSize: number;
  sort: QueueSort;
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
export function pagedQueue(db: DB, opts: PagedQueueOpts): PagedQueueResult {
  // UNCLASSIFIED_DIRECTION is a display sentinel for a NULL matches.direction (see
  // queueByDirection) — it never appears as an actual column value, so the filter below must
  // become "IS NULL" rather than a literal string match, or the 未分类 tab would always be empty.
  const directionFilter = opts.direction === UNCLASSIFIED_DIRECTION ? "m.direction IS NULL" : "m.direction = ?";
  const directionParams = opts.direction === UNCLASSIFIED_DIRECTION ? [] : [opts.direction];

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) n
         FROM applications a
         JOIN jobs j ON j.id = a.job_id
         JOIN matches m ON m.job_id = j.id
         WHERE a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
           AND ${directionFilter}`
      )
      .get(...directionParams) as { n: number }
  ).n;

  const pages = total === 0 ? 1 : Math.max(1, Math.ceil(total / opts.pageSize));
  const page = Math.min(Math.max(1, opts.page), pages);
  const offset = (page - 1) * opts.pageSize;

  const secondarySort =
    opts.sort === "company"
      ? "j.company COLLATE NOCASE ASC, j.title ASC"
      : opts.sort === "fresh"
      ? "(j.posted_at IS NULL) ASC, j.posted_at DESC, j.created_at DESC"
      : "COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC";

  const rows = db
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.apply_url, m.direction, m.score, m.tier, m.reason,
              j.posted_at, a.pinned,
              j.jd_status,
              (SELECT COUNT(*) FROM jobs d WHERE d.duplicate_of = j.id) AS dup_count
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched' AND a.needs_manual_reason IS NULL AND ${QUEUE_ELIGIBLE_SQL}
         AND ${directionFilter}
       ORDER BY a.pinned DESC, ${secondarySort}
       LIMIT ? OFFSET ?`
    )
    .all(...directionParams, opts.pageSize, offset) as PagedQueueRow[];

  return { rows, total, pages };
}
