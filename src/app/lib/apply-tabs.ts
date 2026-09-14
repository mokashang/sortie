import type { OverviewCounts } from "@/app/lib/overview-types";

// The 投递 page's four inboxes sit side by side as tabs (?tab=…): 待处理 / 待确认 / 内推进行中 /
// 今日已提交. Pure, so the server (which tab opens first) and the client (labels, counts) agree.
export const APPLY_TABS = ["todo", "confirm", "referrals", "submitted"] as const;
export type ApplyTab = (typeof APPLY_TABS)[number];
export type ApplyTabCounts = Record<ApplyTab, number>;

export function isApplyTab(v: unknown): v is ApplyTab {
  return typeof v === "string" && (APPLY_TABS as readonly string[]).includes(v);
}

// The number on each tab: the same figures the shell badge and the 今日 ledger already show.
export function applyTabCounts(c: OverviewCounts): ApplyTabCounts {
  return { todo: c.needsInfo, confirm: c.awaitingConfirm, referrals: c.referralInFlight, submitted: c.submittedToday };
}

// Where the page opens without ?tab=: the first inbox with something in it, in the order the
// user works through them. An empty day lands on 待处理, whose empty state says what would appear.
export function defaultApplyTab(n: ApplyTabCounts): ApplyTab {
  return APPLY_TABS.find((t) => n[t] > 0) ?? "todo";
}
