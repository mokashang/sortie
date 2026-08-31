import { DB, logEvent } from "@/lib/db";
import { LlmBackend } from "@/llm/types";
import { buildMatchPrompt, parseMatchResults, MatchProfile, MatchJobInput, MatchResult } from "@/matcher/prompt";

export interface MatchOptions {
  backend: LlmBackend;
  profile: MatchProfile;
  batchSize?: number;   // jobs per LLM call
  threshold?: number;   // score below which (or skip=true) → archived
  limit?: number;       // max jobs to score this run (for incremental passes)
  // When true, also re-score jobs whose application already archived (overwriting their old
  // match row) — an escape hatch so a single under-calibrated pass doesn't permanently bury a
  // real opportunity behind the "already has a match row" resumable gate. Default false.
  rescoreArchived?: boolean;
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
}

export async function runMatching(db: DB, opts: MatchOptions): Promise<MatchSummary> {
  const startedAt = Date.now();
  const batchSize = opts.batchSize ?? 10;
  const threshold = opts.threshold ?? 40;
  const summary: MatchSummary = { scored: 0, matched: 0, archived: 0, errors: [], durationMs: 0 };

  // Only score jobs that: are not visa-flagged, and have no match row yet (resumable) — plus,
  // when rescoreArchived is set, jobs whose application status is 'archived' even though they
  // already have a match row (the rescue path for an under-calibrated earlier pass).
  const rescoreClause = opts.rescoreArchived ? " OR a.status = 'archived'" : "";
  const rows = db
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.jd_text
       FROM jobs j
       JOIN applications a ON a.job_id = j.id
       LEFT JOIN matches m ON m.job_id = j.id
       WHERE j.visa_flag IS NULL AND (m.id IS NULL${rescoreClause})
       ORDER BY j.created_at DESC
       ${opts.limit ? "LIMIT " + Number(opts.limit) : ""}`
    )
    .all() as JobRow[];

  // ON CONFLICT ... DO UPDATE (rather than DO NOTHING) so the rescoreArchived path can overwrite
  // an existing match row with fresh score/direction/reason.
  const insMatch = db.prepare(
    `INSERT INTO matches (job_id, direction, score, tier, reason, skip_reason) VALUES (?,?,?,?,?,?)
     ON CONFLICT(job_id) DO UPDATE SET
       direction=excluded.direction,
       score=excluded.score,
       tier=excluded.tier,
       reason=excluded.reason,
       skip_reason=excluded.skip_reason`
  );
  const setStatus = db.prepare("UPDATE applications SET status=? WHERE job_id=? AND status IN ('discovered','matched','archived')");

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
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
      summary.errors.push({ batch: i / batchSize, error: String(e) });
      continue;
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
        const archived = res.skip || res.score < threshold;
        // Archived rows should always carry a reason: the model's own skip vs. our threshold cut.
        const skipReason = res.skip ? "low fit" : archived ? `low score (${res.score})` : null;
        insMatch.run(r.id, res.direction, res.score, tier, res.reason, skipReason);
        const info = setStatus.run(archived ? "archived" : "matched", r.id);
        summary.scored++;
        // Only count matched/archived when the UPDATE actually changed a row — a job already past
        // these states (e.g. 'submitted') still gets its match row written, but the counters
        // should reflect the real status transition, not a no-op.
        if (info.changes > 0) {
          if (archived) summary.archived++;
          else summary.matched++;
        }
      }
    });
    tx();
  }

  summary.durationMs = Date.now() - startedAt;
  logEvent(db, "match_done", { entity: "matcher", payload: summary });
  return summary;
}
