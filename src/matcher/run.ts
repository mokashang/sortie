import { DB, logEvent } from "@/lib/db";
import { LlmBackend } from "@/llm/types";
import { buildMatchPrompt, parseMatchResults, MatchProfile, MatchJobInput, MatchResult } from "@/matcher/prompt";
import { applyEligibility, archiveCluster } from "@/apply/eligibility";

export interface MatchOptions {
  // The account whose profile is being matched — matches/applications rows are written for it.
  userId: string;
  backend: LlmBackend;
  profile: MatchProfile;
  batchSize?: number;   // jobs per LLM call
  threshold?: number;   // score below which (or skip=true) → archived
  limit?: number;       // max jobs to score this run (for incremental passes)
  // Only score jobs created at/after this sqlite datetime ("YYYY-MM-DD HH:MM:SS" or ISO). A new
  // account should not burn the hourly budget on months-old postings — spec 2026-09-13 §4 sets
  // this to 45 days before the account was created.
  since?: string;
  // Max number of LLM batch calls (opts.backend.complete) in flight at once. Default 1 preserves
  // the original fully-sequential behavior. DB writes (one db.transaction per batch) always run
  // synchronously as each call resolves, so writes never interleave regardless of concurrency.
  concurrency?: number;
  // When true, also re-score jobs whose application already archived (overwriting their old
  // match row) — an escape hatch so a single under-calibrated pass doesn't permanently bury a
  // real opportunity behind the "already has a match row" resumable gate. Default false.
  rescoreArchived?: boolean;
  // When true, re-score jobs already in 'matched' status with a real JD (instead of the normal
  // "score unscored jobs" pass) — used to backfill sponsorship/degree/role on the existing queue.
  // Archives only on an eligibility hard-rule failure, never purely for a low score, and never
  // for a pinned row. Default false.
  rescoreMatched?: boolean;
  // Only these jobs (still subject to the "no match row yet" gate above): the 问助手 chat scores
  // one posting the user asked to apply to right away instead of waiting for the hourly pass.
  jobIds?: number[];
}

export interface MatchSummary {
  scored: number;
  matched: number;
  archived: number;
  errors: { batch: number; error: string }[];
  durationMs: number;
}

interface JobRow {
  id: number;
  company: string;
  title: string;
  location: string | null;
  jd_text: string | null;
  pinned: number;
  status: string;
}

export async function runMatching(db: DB, opts: MatchOptions): Promise<MatchSummary> {
  const startedAt = Date.now();
  const userId = opts.userId;
  const batchSize = opts.batchSize ?? 10;
  const threshold = opts.threshold ?? 40;
  const summary: MatchSummary = { scored: 0, matched: 0, archived: 0, errors: [], durationMs: 0 };

  // Only score jobs that: are not visa-flagged, and have no match row for this user yet
  // (resumable) — plus, when rescoreArchived is set, jobs whose application status is 'archived'
  // even though they already have a match row (the rescue path for an under-calibrated pass).
  // The applications row for (user, job) always exists (backfilled at sign-up / written by the
  // scanner), so the inner JOIN is what scopes the pass to this account.
  const rescoreClause = opts.rescoreArchived ? " OR a.status = 'archived'" : "";
  const ids = (opts.jobIds ?? []).filter((n) => Number.isInteger(n) && n > 0);
  const sinceClause = (opts.since ? " AND j.created_at >= ?" : "") + (ids.length ? ` AND j.id IN (${ids.map(() => "?").join(",")})` : "");
  const sinceParams: unknown[] = [...(opts.since ? [opts.since] : []), ...ids];
  const rows = (
    opts.rescoreMatched
      ? db.prepare(
          `SELECT j.id, j.company, j.title, j.location, j.jd_text, a.pinned, a.status
           FROM jobs j JOIN applications a ON a.job_id = j.id AND a.user_id = ? JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
           WHERE a.status = 'matched' AND j.duplicate_of IS NULL AND j.visa_flag IS NULL AND j.loc_flag IS NULL
             AND j.jd_text <> '' AND j.jd_text NOT LIKE '[listing metadata]%'${sinceClause}
           ORDER BY j.created_at DESC ${opts.limit ? "LIMIT " + Number(opts.limit) : ""}`
        ).all(userId, ...sinceParams)
      : db.prepare(
          `SELECT j.id, j.company, j.title, j.location, j.jd_text, a.pinned, a.status
           FROM jobs j JOIN applications a ON a.job_id = j.id AND a.user_id = ? LEFT JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
           WHERE j.visa_flag IS NULL AND j.loc_flag IS NULL AND j.duplicate_of IS NULL AND (m.id IS NULL${rescoreClause})${sinceClause}
           ORDER BY j.created_at DESC ${opts.limit ? "LIMIT " + Number(opts.limit) : ""}`
        ).all(userId, ...sinceParams)
  ) as JobRow[];

  // ON CONFLICT ... DO UPDATE (rather than DO NOTHING) so the rescoreArchived path can overwrite
  // an existing match row with fresh score/direction/reason.
  const insMatch = db.prepare(
    `INSERT INTO matches (user_id, job_id, direction, score, tier, reason, skip_reason) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(user_id, job_id) DO UPDATE SET
       direction=excluded.direction,
       score=excluded.score,
       tier=excluded.tier,
       reason=excluded.reason,
       skip_reason=excluded.skip_reason`
  );
  const setStatus = db.prepare("UPDATE applications SET status=? WHERE user_id=? AND job_id=? AND status IN ('discovered','matched','archived')");

  // Slice the (already-selected, order-fixed) rows into fixed batches up front — concurrency only
  // affects how these batches are *processed*, never which jobs land in which batch.
  const batches: JobRow[][] = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    batches.push(rows.slice(i, i + batchSize));
  }

  // Runs one batch: the slow await (backend.complete) happens outside any transaction; the DB
  // write below is a single synchronous db.transaction. better-sqlite3 is synchronous and JS is
  // single-threaded, so as long as nothing awaits *inside* the transaction, concurrent batches can
  // never interleave their writes — whichever batch's promise resolves first simply runs its
  // transaction to completion before the next one gets a turn.
  async function processBatch(batch: JobRow[], batchIndex: number): Promise<void> {
    const inputs: MatchJobInput[] = batch.map((r) => ({
      id: r.id,
      company: r.company,
      title: r.title,
      location: r.location,
      jdText: r.jd_text ?? "",
    }));
    const req = buildMatchPrompt(opts.profile, inputs);
    let results;
    try {
      const res = await opts.backend.complete(req);
      results = parseMatchResults(res.text);
    } catch (e) {
      summary.errors.push({ batch: batchIndex, error: String(e) });
      return;
    }

    // First-occurrence wins: a stray duplicate job_id later in the model's response must not
    // clobber a good earlier score for the same job.
    const byId = new Map<number, MatchResult>();
    for (const r of results) {
      if (!byId.has(r.job_id)) byId.set(r.job_id, r);
    }
    const tx = db.transaction(() => {
      for (const r of batch) {
        const res = byId.get(r.id);
        if (!res) continue; // model omitted this job — leave unscored for a later run
        const tier = res.direction ? (opts.profile.directions[res.direction] ?? null) : null;
        // Job-level facts (sponsorship / degree / role) are shared: applyEligibility writes them on
        // the job and, on a hard failure, archives the cluster for every account (archive:false
        // here so the pinned check below stays per-row for this account's own row).
        const elig = applyEligibility(
          db,
          { jobId: r.id, sponsorship: res.sponsorship, degree: res.degree, role: res.role, source: "match_llm", evidence: res.reason },
          { archive: false }
        );
        const failReason = elig.written ? elig.failReason : null;
        const lowScore = res.skip || res.score < threshold;
        // rescoreMatched: 只因资格失败归档;常规打分:资格失败或低分都归档。任何模式下都绝不
        // 自动归档 pinned 行 —— 用户手动置顶是比任何自动判断更强的信号。
        const wantsArchive = opts.rescoreMatched ? failReason !== null : failReason !== null || lowScore;
        const archived = wantsArchive && r.pinned === 0;
        const skipReason = failReason ?? (res.skip ? "low fit" : lowScore ? `low score (${res.score})` : null);
        insMatch.run(userId, r.id, res.direction, res.score, tier, res.reason, opts.rescoreMatched && !failReason ? null : skipReason);
        if (failReason && archived) archiveCluster(db, r.id, failReason, { respectPinned: true });
        // Pinned rows are protected from auto-ARCHIVING only, never from PROMOTION: a pinned row
        // never gets flipped to 'archived' by the matcher (see `archived` above), but a pinned
        // row a human requeued to 'discovered' (e.g. via jd_review) must still be promotable back
        // to 'matched' once it scores — otherwise it silently vanishes from every surface. Score/
        // skip_reason/eligibility fields are still written above regardless of pinned status.
        const changes =
          r.pinned === 0
            ? setStatus.run(archived ? "archived" : "matched", userId, r.id).changes
            : archived
              ? 0
              : db.prepare("UPDATE applications SET status = 'matched' WHERE user_id = ? AND job_id = ? AND status = 'discovered'").run(userId, r.id).changes;
        summary.scored++;
        // Only count matched/archived when the UPDATE actually changed a row — a job already past
        // these states (e.g. 'submitted') still gets its match row written, but the counters
        // should reflect the real status transition, not a no-op.
        if (archived) summary.archived++;
        else if (changes > 0) summary.matched++;
      }
    });
    tx();
  }

  const concurrency = Math.max(1, opts.concurrency ?? 1);

  // A small worker pool: each worker pulls the next batch index off a shared cursor, awaits the
  // (slow) LLM call, then does its synchronous DB write, then loops. With concurrency=1 this is
  // exactly the original sequential loop. Batches write in whatever order their backend calls
  // resolve, not necessarily index order — summary aggregation is safe because every mutation of
  // `summary` happens synchronously after an await resolves, never concurrently with another.
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const batchIndex = nextIndex++;
      if (batchIndex >= batches.length) return;
      await processBatch(batches[batchIndex], batchIndex);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, batches.length) }, () => worker());
  await Promise.all(workers);

  summary.durationMs = Date.now() - startedAt;
  logEvent(db, "match_done", { userId, entity: "matcher", payload: summary });
  return summary;
}
