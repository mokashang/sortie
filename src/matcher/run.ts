import { DB, logEvent } from "@/lib/db";
import { LlmBackend } from "@/llm/types";
import { buildMatchPrompt, parseMatchResults, MatchProfile, MatchJobInput } from "@/matcher/prompt";

export interface MatchOptions {
  backend: LlmBackend;
  profile: MatchProfile;
  batchSize?: number;   // jobs per LLM call
  threshold?: number;   // score below which (or skip=true) → archived
  limit?: number;       // max jobs to score this run (for incremental passes)
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

  // Only score jobs that: are not visa-flagged, and have no match row yet (resumable).
  const rows = db
    .prepare(
      `SELECT j.id, j.company, j.title, j.location, j.jd_text
       FROM jobs j
       LEFT JOIN matches m ON m.job_id = j.id
       WHERE j.visa_flag IS NULL AND m.id IS NULL
       ORDER BY j.created_at DESC
       ${opts.limit ? "LIMIT " + Number(opts.limit) : ""}`
    )
    .all() as JobRow[];

  const insMatch = db.prepare(
    "INSERT INTO matches (job_id, direction, score, tier, reason, skip_reason) VALUES (?,?,?,?,?,?) ON CONFLICT(job_id) DO NOTHING"
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

    const byId = new Map(results.map((r) => [r.job_id, r]));
    const tx = db.transaction(() => {
      for (const r of batch) {
        const res = byId.get(r.id);
        if (!res) continue; // model omitted this job — leave unscored for a later run
        const tier = res.direction ? (opts.profile.directions[res.direction] ?? null) : null;
        const skipReason = res.skip ? "low fit" : null;
        insMatch.run(r.id, res.direction, res.score, tier, res.reason, skipReason);
        const archived = res.skip || res.score < threshold;
        setStatus.run(archived ? "archived" : "matched", r.id);
        summary.scored++;
        if (archived) summary.archived++;
        else summary.matched++;
      }
    });
    tx();
  }

  summary.durationMs = Date.now() - startedAt;
  logEvent(db, "match_done", { entity: "matcher", payload: summary });
  return summary;
}
