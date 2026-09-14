import { describe, expect, it } from "vitest";
import { APPLY_TABS, applyTabCounts, defaultApplyTab, isApplyTab } from "@/app/lib/apply-tabs";
import type { OverviewCounts } from "@/app/lib/overview-types";

const zero: OverviewCounts = {
  awaitingConfirm: 0,
  approvedWaiting: 0,
  needsInfo: 0,
  referralDrafts: 0,
  referralProgress: 0,
  referralInFlight: 0,
  networkDrafts: 0,
  networkPendingSend: 0,
  queueMatched: 0,
  submittedToday: 0,
  submittedThisWeek: 0,
};

describe("apply page tabs", () => {
  it("accepts only the four tab keys", () => {
    for (const t of APPLY_TABS) expect(isApplyTab(t)).toBe(true);
    expect(isApplyTab("plan")).toBe(false);
    expect(isApplyTab(undefined)).toBe(false);
    expect(isApplyTab(1)).toBe(false);
  });

  it("shows the same numbers as the shell badge and the ledger", () => {
    expect(applyTabCounts({ ...zero, needsInfo: 2, awaitingConfirm: 5, referralInFlight: 3, submittedToday: 1 })).toEqual({
      todo: 2,
      confirm: 5,
      referrals: 3,
      submitted: 1,
    });
  });

  it("opens the first inbox with something in it, else the to-do tab", () => {
    expect(defaultApplyTab(applyTabCounts(zero))).toBe("todo");
    expect(defaultApplyTab(applyTabCounts({ ...zero, awaitingConfirm: 1, referralInFlight: 4 }))).toBe("confirm");
    expect(defaultApplyTab(applyTabCounts({ ...zero, referralInFlight: 4 }))).toBe("referrals");
    expect(defaultApplyTab(applyTabCounts({ ...zero, submittedToday: 2 }))).toBe("submitted");
    expect(defaultApplyTab(applyTabCounts({ ...zero, needsInfo: 1, awaitingConfirm: 9 }))).toBe("todo");
  });
});
