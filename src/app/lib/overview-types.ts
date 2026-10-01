// Shape of GET /api/overview, shared by the server composer (src/apply/overview.ts) and the
// client (sidebar badges, 今日 page). Client-safe: no db imports.
import type { RunStatusRow } from "@/executor/runner";

export interface OverviewCounts {
  awaitingConfirm: number;
  approvedWaiting: number;
  needsInfo: number;
  referralDrafts: number;
  referralProgress: number;
  referralInFlight: number;
  networkDrafts: number;
  networkPendingSend: number;
  queueMatched: number;
  submittedToday: number;
  submittedThisWeek: number;
}

export interface Overview {
  today: string;
  // The task to show first: a running one before a queued one, newest first.
  assistant: RunStatusRow | null;
  // Every task currently queued or running, in the same order (tasks can run side by side).
  liveRuns: RunStatusRow[];
  // Kinds of every task currently queued or running (an apply run can be queued while a scan runs).
  liveKinds: string[];
  // How many apply tasks the assistant works on at once (设置 → 同时进行的任务).
  parallel: number;
  counts: OverviewCounts;
  // false until the account's 档案 basics validate — the assistant can't match or apply before that.
  profileComplete: boolean;
}

// Things only the user can move forward: unapproved confirmations, the 待处理 cards (missing
// answers / files, a site to log into once, something to finish by hand), unapproved referral
// drafts, and referral conversations that need a 「有内推了」 decision.
export function attentionTotal(c: OverviewCounts): number {
  return Math.max(0, c.awaitingConfirm - c.approvedWaiting) + c.needsInfo + c.referralDrafts + c.referralProgress;
}
