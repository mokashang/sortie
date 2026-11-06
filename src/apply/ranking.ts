import { DB, logEvent } from "@/lib/db";
import { AUTO_RETRY_PREFIX, InfoQuestion, infoKind, unpark } from "@/apply/queue";
import { APPLY_CHUNK_SIZE, campaignLeft, campaignOptions } from "@/apply/continue";
import { queueTargetedRun } from "@/apply/followup";
import { retryBlockedSubmit } from "@/apply/submit-blocked";
import { lastRunChannel, startExecutor } from "@/executor/runner";
import { applyChannelFor } from "@/executor/channel";

// 天梯清单 (2026-11-06, the user: "把天梯清单直接放到 sortie 里,然后我在 sortie 里操作投递"). The
// ranked list started as a markdown file and a task's options (src/apply/continue.ts): nobody could
// see it in the App, or say where to go next. It now lives in two tables, per account, and the
// 投递 page's 天梯 tab shows every company with what became of each job. What a job's state means
// comes straight from its application row; the list itself stores only the order.

export const RANKED_STATES = ["todo", "active", "login", "submit", "action", "text", "manual", "submitted", "archived"] as const;
export type RankedState = (typeof RANKED_STATES)[number];

export interface RankedJob {
  jobId: number;
  title: string;
  score: number | null;
  state: RankedState;
  // Why it was archived, or what the card is about. Written by the assistant: shown, not translated.
  detail: string | null;
}

export interface RankedCompany {
  rank: number;
  company: string;
  value: string | null;
  note: string | null;
  jobs: RankedJob[];
}

export interface RankedRun {
  id: number;
  status: string;
  summary: string | null;
}

export interface RankingBoard {
  companies: RankedCompany[];
  counts: Record<RankedState, number>;
  total: number;
  run: RankedRun | null;
  // Where 接着投 starts: the first company with a job nothing has happened to yet.
  nextRank: number | null;
}

interface StateFields {
  status: string | null;
  submitted_at: string | null;
  pending_questions: string | null;
  needs_manual_reason: string | null;
}

// Pure (tests/apply-ranking.test.ts). Order matters: a submitted row can still carry an old reason.
export function rankedState(a: StateFields): RankedState {
  if (a.submitted_at) return "submitted";
  if (a.status === "archived") return "archived";
  if (a.needs_manual_reason?.startsWith(AUTO_RETRY_PREFIX)) return "active"; // the App retries it by itself
  let items: InfoQuestion[] = [];
  try {
    items = a.pending_questions ? (JSON.parse(a.pending_questions) as InfoQuestion[]) : [];
  } catch {
    items = [];
  }
  const kinds = new Set(items.map(infoKind));
  if (kinds.has("login")) return "login";
  if (kinds.has("submit")) return "submit";
  if (kinds.has("manual") || (a.needs_manual_reason && kinds.size === 0)) return "manual";
  if (kinds.has("action")) return "action";
  if (kinds.size > 0) return "text";
  if (a.status === "prepared" || a.status === "awaiting_confirm" || a.status === "needs_info") return "active";
  return "todo";
}

function cardLabel(pending: string | null): string | null {
  try {
    const items = pending ? (JSON.parse(pending) as InfoQuestion[]) : [];
    return items[0]?.label ?? null;
  } catch {
    return null;
  }
}

interface JobRow extends StateFields {
  rank: number;
  job_id: number;
  score: number | null;
  title: string;
}

function jobRows(db: DB, userId: string): JobRow[] {
  return db
    .prepare(
      `SELECT r.rank, r.job_id, r.score, j.title, a.status, a.submitted_at, a.pending_questions, a.needs_manual_reason
       FROM ranked_jobs r JOIN jobs j ON j.id = r.job_id
       LEFT JOIN applications a ON a.job_id = r.job_id AND a.user_id = r.user_id
       WHERE r.user_id = ? ORDER BY r.rank, r.position`
    )
    .all(userId) as JobRow[];
}

// The task working the list, if one is on: running, queued, or paused behind its own cards.
export function liveRankedRun(db: DB, userId: string): RankedRun | null {
  const row = db
    .prepare(
      `SELECT id, status, summary FROM executor_runs
       WHERE user_id = ? AND kind = 'apply' AND status IN ('running','queued','paused') AND options LIKE '%"campaign"%'
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId) as RankedRun | undefined;
  return row ?? null;
}

export function rankingBoard(db: DB, userId: string): RankingBoard {
  const companies = (
    db.prepare("SELECT rank, company, value_label, note FROM ranked_companies WHERE user_id = ? ORDER BY rank").all(userId) as {
      rank: number;
      company: string;
      value_label: string | null;
      note: string | null;
    }[]
  ).map((c): RankedCompany => ({ rank: c.rank, company: c.company, value: c.value_label, note: c.note, jobs: [] }));
  const byRank = new Map(companies.map((c) => [c.rank, c]));
  const counts = Object.fromEntries(RANKED_STATES.map((s) => [s, 0])) as Record<RankedState, number>;
  const rows = jobRows(db, userId);
  for (const r of rows) {
    const state = rankedState(r);
    counts[state]++;
    byRank.get(r.rank)?.jobs.push({
      jobId: r.job_id,
      title: r.title,
      score: r.score,
      state,
      detail: state === "archived" ? r.needs_manual_reason : cardLabel(r.pending_questions),
    });
  }
  const next = companies.find((c) => c.jobs.some((j) => j.state === "todo"));
  return { companies, counts, total: rows.length, run: liveRankedRun(db, userId), nextRank: next?.rank ?? null };
}

export function rankedLeft(db: DB, userId: string): number {
  return rankingBoard(db, userId).counts.todo;
}

export class RankingBusyError extends Error {
  constructor(public runId: number) {
    super(`ranking: task #${runId} is already working the list`);
  }
}

// 从这里往下投: the jobs nothing has happened to, from this company down, as a relay of segments
// (the same list machinery as #670). One task works the list at a time.
export function startRankedFrom(db: DB, userId: string, fromRank: number): { runId: number; jobs: number } {
  const live = liveRankedRun(db, userId);
  if (live) throw new RankingBusyError(live.id);
  const rows = jobRows(db, userId);
  const all = rows.map((r) => r.job_id);
  const ids = campaignLeft(db, userId, rows.filter((r) => r.rank >= fromRank).map((r) => r.job_id));
  if (ids.length === 0) return { runId: 0, jobs: 0 };
  const channel = applyChannelFor(db, userId, lastRunChannel);
  const started = startExecutor(db, userId, "apply", campaignOptions(ids, APPLY_CHUNK_SIZE, ids.length, all), { queueBehind: true }, channel);
  logEvent(db, "ranking_started", { userId, entity: "run", entityId: started.id, payload: { fromRank, jobs: ids.length } });
  return { runId: started.id, jobs: ids.length };
}

export interface StartPickedResult {
  runId: number | null;
  started: number[];
  skipped: number[];
}

// 投选中的: the picked jobs next, in list order. A job on a card is handed back first. A login wall
// is not: the wall holds every job on that site until the user has signed in, so it is left for the
// 待处理 tab. Submitted, archived and in-hand jobs have nothing to start.
export function startRankedPicked(db: DB, userId: string, jobIds: number[]): StartPickedResult {
  const picked = new Set(jobIds);
  const started: number[] = [];
  const skipped: number[] = [];
  for (const r of jobRows(db, userId)) {
    if (!picked.has(r.job_id)) continue;
    const state = rankedState(r);
    if (state === "todo") started.push(r.job_id);
    else if (state === "submit") {
      retryBlockedSubmit(db, userId, r.job_id, undefined);
      skipped.push(r.job_id); // retryBlockedSubmit queues its own run
    } else if (state === "action" || state === "text" || state === "manual") {
      unpark(db, userId, r.job_id);
      started.push(r.job_id);
    } else skipped.push(r.job_id);
  }
  const follow = started.length > 0 ? queueTargetedRun(db, userId, started, "direct") : null;
  return { runId: follow?.runId ?? null, started, skipped };
}
