// Client-safe: how a finished task is judged against what it was asked to do, and the 接力
// (chained segments) vocabulary shared by server and UI. The server (src/apply/run-outcome.ts)
// writes an outcome snapshot into executor_runs.outcome when an apply run with a plan reaches a
// terminal status; the UI derives the status label from it so a task that filled 5 of a planned
// 70 reads 「未完成 · 海投 5/70」, never 「已完成」 (2026-09-13, task #68). Every text here comes
// from the message tree in the language asked for.
import type { Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";
import { RUN_STATUS_TONE, labelOf, Tone } from "@/app/lib/labels";

export interface ModeCounts {
  direct: number;
  referral: number;
}

// 接力 (src/apply/continue.ts): a plan bigger than one session can carry is done in segments.
// Each segment is its own run; these constants are what the user agreed to on 2026-09-13.
export const APPLY_CHUNK_SIZE = 10; // a segment stops after this many filled/claimed and finishes normally
export const BACKLOG_PAUSE_AT = 10; // unconfirmed filled applications at a segment boundary → the chain pauses
export const BACKLOG_RESUME_AT = 5; // …and resumes once the user has brought the backlog down to this

// Carried in a continuation run's options.chain: which chain, which segment, what the whole
// chain was asked for and what earlier segments already achieved.
export interface ChainInfo {
  root: number; // the run the user started (段 1)
  step: number; // 1-based segment number of this run
  planned: ModeCounts; // the whole chain's plan (the root run's quotas)
  before: ModeCounts; // achieved by the segments before this one
  zeroRuns: number; // consecutive segments so far that achieved nothing
}

export interface RunOutcome {
  // What the plan asked for, per mode: the whole chain's quotas for a chained run, else this
  // run's options.plan quotas (or a targeted jobIds run's size).
  planned: ModeCounts;
  // Cumulative achievement (earlier segments + this run), protocol count semantics
  // (CLAUDE.md §3.3): 海投 = filled and reported awaiting_confirm (whatever happened after);
  // 内推 = jobs that entered referral_seeking and got a contact (a 找不到人 company does not count).
  achieved: ModeCounts;
  own: ModeCounts; // this run's share of achieved
  submitted: number; // of own.direct: already submitted when the run ended
  awaiting: number; // of own.direct: still waiting for the user's confirmation
  manual: number; // referral companies where nobody could be contacted (找不到人)
  archived: number; // live page proved the job ineligible, or the posting was gone → archived
  info: number; // 待处理 cards: missing answers / files, a login wall, something to finish by hand, an error, a rejected fill
  complete: boolean; // achieved >= planned for both modes
  chain?: { root: number; step: number }; // present for continuation segments
}

// Status chip for a task. A normally-ended run that fell short of its plan is 未完成, not 已完成;
// failed / stopped / paused / live runs keep their own labels (the progress text still shows).
export function runStatusDisplay(status: string, outcome: RunOutcome | null | undefined, lang: Lang): { label: string; tone: Tone } {
  const t = messages[lang];
  if (status === "done" && outcome && !outcome.complete) return { label: t.runs.incomplete, tone: "warn" };
  return { label: labelOf(t.labels.runStatus, status, status), tone: RUN_STATUS_TONE[status] ?? "neutral" };
}

// "海投 15/70 · 内推 0/40 · 本段 10" — only the modes the plan asked for; the 本段 share only for
// a chained segment; "" when there is no outcome.
export function runProgressText(outcome: RunOutcome | null | undefined, lang: Lang): string {
  if (!outcome) return "";
  const t = messages[lang].runs;
  const parts: string[] = [];
  if (outcome.planned.direct > 0) parts.push(t.progressDirect(outcome.achieved.direct, outcome.planned.direct));
  if (outcome.planned.referral > 0) parts.push(t.progressReferral(outcome.achieved.referral, outcome.planned.referral));
  if (outcome.chain) parts.push(t.segmentShare(outcome.own.direct + outcome.own.referral));
  return parts.join(" · ");
}

// "提交 5 · 待确认 1 · 待处理 3 · 归档 2 · 找不到人 1" — zero buckets omitted; "" when nothing to say.
export function runBreakdownText(outcome: RunOutcome | null | undefined, lang: Lang): string {
  if (!outcome) return "";
  const t = messages[lang].runs;
  const parts: string[] = [];
  if (outcome.submitted > 0) parts.push(t.breakdownSubmitted(outcome.submitted));
  if (outcome.awaiting > 0) parts.push(t.breakdownAwaiting(outcome.awaiting));
  if (outcome.info > 0) parts.push(t.breakdownInfo(outcome.info));
  if (outcome.archived > 0) parts.push(t.breakdownArchived(outcome.archived));
  if (outcome.manual > 0) parts.push(t.breakdownManual(outcome.manual));
  return parts.join(" · ");
}
