import type { DB } from "@/lib/db";
import { logEvent } from "@/lib/db";
import type { Lang } from "@/i18n/lang";
import type { LlmBackend } from "@/llm/types";
import { tryLoadProfile } from "@/lib/profile";
import { runMatching } from "@/matcher/run";
import { queueTargetedRun, type FollowupDeps } from "@/apply/followup";
import { unarchive } from "@/apply/queue";
import { upsertJobs } from "@/scanner/upsert";
import { fetchJdText } from "@/scanner/jd-fetch";
import { directionName } from "@/app/lib/labels";
import { localFull } from "@/app/lib/time";

// The three things the 问助手 chat can DO besides answering (spec 2026-09-18 §9): look a posting
// up in the library, start a direct application to one, and add a posting the user hands it by
// URL. Each is a plain function over the same code paths the pages use — a targeted apply run is
// queued exactly like the 待处理 card's 「让助手再试一次」 — and every result is returned as a short
// English observation the model turns into the answer. Nothing here submits or sends: the run
// still ends on a 待确认 card (or the 自动投递 switch), and messages to people have no tool at all.

export type ToolCall =
  | { tool: "search_jobs"; query: string }
  | { tool: "apply"; jobId: number; force?: boolean }
  | { tool: "add_job"; url: string; company: string; title: string; location?: string | null };

export interface ToolEvent {
  tool: ToolCall["tool"];
  ok: boolean;
  jobId?: number;
  company?: string;
  title?: string;
  runId?: number;
  merged?: boolean;
  blocked?: string;
}

export interface ToolResult {
  observation: string;
  event: ToolEvent;
}

export interface ToolDeps {
  // Scores a posting that has no match row yet (the global AI provider, like the pipeline).
  backend?: LlmBackend;
  followup?: FollowupDeps;
  fetchJd?: (url: string) => Promise<string | null>;
  now?: () => number;
}

export const MAX_SEARCH_ROWS = 8;

// Parses the single `ACTION: {...}` line the model may answer with. Null when the text is an
// ordinary answer; throws on a malformed or unknown action so the loop can tell the model.
export function parseAction(text: string): ToolCall | null {
  const m = text.trim().match(/^ACTION:\s*(\{[\s\S]*\})\s*$/);
  if (!m) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(m[1]);
  } catch {
    throw new Error("ACTION is not valid JSON");
  }
  switch (raw.tool) {
    case "search_jobs":
      if (typeof raw.query !== "string" || !raw.query.trim()) throw new Error("search_jobs needs a query");
      return { tool: "search_jobs", query: raw.query.trim().slice(0, 200) };
    case "apply": {
      const id = Number(raw.jobId);
      if (!Number.isInteger(id) || id <= 0) throw new Error("apply needs a numeric jobId");
      return { tool: "apply", jobId: id, force: raw.force === true };
    }
    case "add_job": {
      const url = typeof raw.url === "string" ? raw.url.trim() : "";
      if (!/^https?:\/\/\S+$/i.test(url)) throw new Error("add_job needs an http(s) url");
      const company = typeof raw.company === "string" ? raw.company.trim() : "";
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      if (!company || !title) throw new Error("add_job needs company and title");
      return { tool: "add_job", url, company: company.slice(0, 200), title: title.slice(0, 300), location: typeof raw.location === "string" ? raw.location.slice(0, 300) : null };
    }
    default:
      throw new Error(`unknown tool ${String(raw.tool)}`);
  }
}

interface SearchRow {
  id: number;
  company: string;
  title: string;
  location: string | null;
  posted_at: string | null;
  created_at: string;
  score: number | null;
  direction: string | null;
  status: string | null;
  needs_manual_reason: string | null;
  submitted_at: string | null;
  duplicate_of: number | null;
}

function describeState(r: Pick<SearchRow, "status" | "needs_manual_reason" | "submitted_at">): string {
  if (!r.status) return "not in your applications yet";
  if (r.submitted_at) return `already submitted ${localFull(r.submitted_at)}`;
  switch (r.status) {
    case "matched":
      return r.needs_manual_reason ? `paused on a to-do card (${r.needs_manual_reason})` : "in the queue";
    case "archived":
      return `archived (${r.needs_manual_reason ?? "low score or skipped"})`;
    case "awaiting_confirm":
      return "filled, waiting for your confirmation";
    case "needs_info":
    case "prepared":
      return "being filled / waiting on a to-do card";
    case "referral_seeking":
      return "in the referral flow";
    case "referral_ready":
      return "has a referral, ready to apply";
    case "discovered":
      return "not scored yet";
    default:
      return r.status;
  }
}

// Words are matched against company and title (case-insensitive); a row needs at least half of
// them (so "Amazon 2027 summer intern" still finds "SDE Intern, ROBOTICS - 2027"), best-matching,
// best-scored and newest first.
export function searchJobs(db: DB, userId: string, query: string): SearchRow[] {
  const words = query
    .toLowerCase()
    .split(/[\s,;/|]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !["the", "and", "for", "job", "jobs", "at", "to", "apply", "岗位", "职位", "投递"].includes(w))
    .slice(0, 6);
  if (words.length === 0) return [];
  const hits = words.map(() => "(CASE WHEN j.company LIKE ? OR j.title LIKE ? THEN 1 ELSE 0 END)").join(" + ");
  const params = words.flatMap((w) => [`%${w}%`, `%${w}%`]);
  const need = Math.ceil(words.length / 2);
  return db
    .prepare(
      `SELECT * FROM (
         SELECT j.id, j.company, j.title, j.location, j.posted_at, j.created_at, j.duplicate_of,
                m.score, m.direction, a.status, a.needs_manual_reason, a.submitted_at, (${hits}) AS hits
         FROM jobs j
         LEFT JOIN matches m ON m.job_id = j.id AND m.user_id = ?
         LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = ?
         WHERE j.visa_flag IS NULL AND j.loc_flag IS NULL
       ) WHERE hits >= ?
       ORDER BY hits DESC, (duplicate_of IS NOT NULL) ASC, (score IS NULL) ASC, score DESC, created_at DESC
       LIMIT ${MAX_SEARCH_ROWS}`
    )
    .all(...params, userId, userId, need) as SearchRow[];
}

function searchObservation(rows: SearchRow[], lang: Lang): string {
  if (rows.length === 0) return "search_jobs: no posting in the library matches. If the user has a link, use add_job with the url, company and title; otherwise say it is not in the library yet.";
  return [
    `search_jobs: ${rows.length} matching posting(s) (job id · company · title · location · posted · score · state):`,
    ...rows.map(
      (r) =>
        `- #${r.id} · ${r.company} · ${r.title} · ${r.location ?? "?"} · ${r.posted_at ? localFull(r.posted_at) : "date unknown"} · ${r.score != null ? `${r.score} (${directionName(r.direction, lang)})` : "not scored"} · ${describeState(r)}${r.duplicate_of ? ` · duplicate of #${r.duplicate_of}` : ""}`
    ),
  ].join("\n");
}

interface AppRow {
  status: string;
  needs_manual_reason: string | null;
  submitted_at: string | null;
}

function appRow(db: DB, userId: string, jobId: number): AppRow | undefined {
  return db.prepare("SELECT status, needs_manual_reason, submitted_at FROM applications WHERE user_id = ? AND job_id = ?").get(userId, jobId) as AppRow | undefined;
}

// Scores one posting for this account if it has no match row yet; fetches the description first
// when the row has none, so the score is not blind. Errors are reported, not thrown.
async function ensureScored(db: DB, userId: string, jobId: number, deps: ToolDeps): Promise<string | null> {
  const has = db.prepare("SELECT 1 FROM matches WHERE user_id = ? AND job_id = ?").get(userId, jobId);
  if (has) return null;
  const profile = tryLoadProfile(db, userId);
  if (!profile) return "the profile is incomplete (Profile → Basics), so the posting cannot be scored or applied to";
  if (!deps.backend) return "no AI backend available to score the posting";
  const job = db.prepare("SELECT apply_url, jd_text FROM jobs WHERE id = ?").get(jobId) as { apply_url: string | null; jd_text: string | null } | undefined;
  if (job && (!job.jd_text || job.jd_text.startsWith("[listing metadata]")) && job.apply_url) {
    const text = await (deps.fetchJd ?? fetchJdText)(job.apply_url);
    if (text && text.trim().length > 200) db.prepare("UPDATE jobs SET jd_text = ?, jd_status = NULL WHERE id = ?").run(text, jobId);
  }
  const s = await runMatching(db, {
    userId,
    backend: deps.backend,
    profile: { directions: profile.directions, work_auth: profile.work_auth },
    batchSize: 1,
    threshold: 40,
    jobIds: [jobId],
    limit: 1,
  });
  if (s.errors.length > 0) return `scoring failed: ${s.errors[0].error.slice(0, 200)}`;
  return null;
}

export async function applyToJob(db: DB, userId: string, jobId: number, force: boolean, lang: Lang, deps: ToolDeps = {}): Promise<ToolResult> {
  const job = db.prepare("SELECT id, company, title, apply_url, duplicate_of FROM jobs WHERE id = ?").get(jobId) as
    | { id: number; company: string; title: string; apply_url: string | null; duplicate_of: number | null }
    | undefined;
  const base: ToolEvent = { tool: "apply", ok: false, jobId };
  if (!job) return { observation: `apply: no posting #${jobId} in the library`, event: base };
  const ev: ToolEvent = { ...base, company: job.company, title: job.title };
  const label = `${job.company} — ${job.title} (#${jobId})`;
  if (!job.apply_url) return { observation: `apply: ${label} has no application link`, event: ev };
  if (job.duplicate_of) {
    return { observation: `apply: ${label} is a duplicate of posting #${job.duplicate_of}; use that one`, event: ev };
  }
  db.prepare("INSERT OR IGNORE INTO applications (user_id, job_id) VALUES (?, ?)").run(userId, jobId);

  let app = appRow(db, userId, jobId)!;
  if (app.submitted_at) return { observation: `apply: ${label} was already submitted ${localFull(app.submitted_at)} — it is in History`, event: ev };
  if (["awaiting_confirm", "prepared", "needs_info"].includes(app.status)) {
    return { observation: `apply: ${label} is already being handled (${describeState(app)}) — see Apply`, event: ev };
  }
  if (app.status === "referral_seeking" && !force) {
    return { observation: `apply: ${label} is in the referral flow (Apply → Referrals in progress); apply again with force:true only if the user wants to apply directly now`, event: { ...ev, blocked: "referral" } };
  }
  if (app.status === "matched" && app.needs_manual_reason && !force) {
    return { observation: `apply: ${label} is paused on a to-do card (${app.needs_manual_reason}); the user has to resolve that card on Apply → To-do (or force:true to try again)`, event: { ...ev, blocked: "todo" } };
  }

  const scoreErr = await ensureScored(db, userId, jobId, deps);
  if (scoreErr) return { observation: `apply: ${label}: ${scoreErr}`, event: ev };
  app = appRow(db, userId, jobId)!;

  if (app.status === "archived") {
    const reason = app.needs_manual_reason ?? "low score";
    if (!force) {
      return {
        observation: `apply: ${label} is archived: ${reason}. Tell the user why and ask whether to apply anyway (then call apply with force:true).`,
        event: { ...ev, blocked: reason },
      };
    }
    unarchive(db, userId, jobId);
  } else if (app.status === "referral_seeking" || (app.status === "matched" && app.needs_manual_reason)) {
    db.prepare("UPDATE applications SET status = 'matched', needs_manual_reason = NULL, pending_questions = NULL WHERE user_id = ? AND job_id = ?").run(userId, jobId);
  } else if (app.status !== "matched" && app.status !== "referral_ready") {
    return { observation: `apply: ${label} is in state '${app.status}' and cannot be applied to from the chat`, event: ev };
  }

  const r = queueTargetedRun(db, userId, [jobId], "direct", deps.followup);
  if (!r.autoStarted || !r.runId) return { observation: `apply: could not queue a task for ${label} (another background run is on); ask the user to try again from Jobs`, event: ev };
  logEvent(db, "chat_apply_started", { userId, entity: "run", entityId: r.runId, payload: { jobId, force } });
  const score = db.prepare("SELECT score, direction FROM matches WHERE user_id = ? AND job_id = ?").get(userId, jobId) as { score: number | null; direction: string | null } | undefined;
  return {
    observation:
      `apply: started task #${r.runId} for ${label}${r.merged ? " (added to an already queued task)" : ""}` +
      `${score?.score != null ? ` · score ${score.score} (${directionName(score.direction, lang)})` : ""}. ` +
      `The assistant will open it in the user's Chrome, fill it and stop on a To confirm card (or submit right away if auto-apply is on); it then appears under Submitted today and in History.`,
    event: { ...ev, ok: true, runId: r.runId, merged: r.merged },
  };
}

export async function addJob(db: DB, call: Extract<ToolCall, { tool: "add_job" }>, deps: ToolDeps = {}): Promise<ToolResult> {
  const existing = db.prepare("SELECT id, company, title FROM jobs WHERE apply_url = ?").get(call.url) as { id: number; company: string; title: string } | undefined;
  if (existing) {
    return { observation: `add_job: that link is already in the library as #${existing.id} (${existing.company} — ${existing.title}); use apply with that jobId`, event: { tool: "add_job", ok: true, jobId: existing.id, company: existing.company, title: existing.title } };
  }
  const jdText = (await (deps.fetchJd ?? fetchJdText)(call.url)) ?? "";
  const s = upsertJobs(db, [
    { company: call.company, title: call.title, location: call.location ?? null, jdText, applyUrl: call.url, source: "manual", ats: null, postedAt: new Date(deps.now?.() ?? Date.now()).toISOString() },
  ]);
  const row = db.prepare("SELECT id, company, title, visa_flag, loc_flag FROM jobs WHERE apply_url = ?").get(call.url) as
    | { id: number; company: string; title: string; visa_flag: string | null; loc_flag: string | null }
    | undefined;
  if (!row) {
    const why = s.visaSkipped ? "its text says no sponsorship / citizens only" : s.locSkipped ? "it is not a US role" : s.errors[0]?.error ?? "unknown";
    return { observation: `add_job: the posting was not added (${why})`, event: { tool: "add_job", ok: false, company: call.company, title: call.title } };
  }
  return {
    observation: `add_job: added #${row.id} (${row.company} — ${row.title})${jdText ? ` with ${jdText.length} characters of description` : " (the description could not be fetched; the assistant reads the live page when applying)"}. Call apply with jobId ${row.id} to start.`,
    event: { tool: "add_job", ok: true, jobId: row.id, company: row.company, title: row.title },
  };
}

export async function runTool(db: DB, userId: string, call: ToolCall, lang: Lang, deps: ToolDeps = {}): Promise<ToolResult> {
  switch (call.tool) {
    case "search_jobs": {
      const rows = searchJobs(db, userId, call.query);
      return { observation: searchObservation(rows, lang), event: { tool: "search_jobs", ok: true } };
    }
    case "apply":
      return applyToJob(db, userId, call.jobId, call.force === true, lang, deps);
    case "add_job":
      return addJob(db, call, deps);
  }
}
