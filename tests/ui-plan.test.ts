import { describe, it, expect } from "vitest";
import { buildPlan, clampCount, planTotals } from "@/app/lib/plan";

describe("apply plan", () => {
  it("clamps", () => {
    expect(clampCount("3", 5)).toBe(3);
    expect(clampCount(9, 5)).toBe(5);
    expect(clampCount(-1, 5)).toBe(0);
    expect(clampCount("x", 5)).toBe(0);
    expect(clampCount(2.7, 5)).toBe(2);
  });
  it("orders referral entries first, keeps direction order, skips zeros", () => {
    const counts = { mle: { referral: 0, direct: 2 }, swe_general: { referral: 1, direct: 3 } };
    expect(buildPlan(["mle", "swe_general"], counts)).toEqual([
      { direction: "swe_general", count: 1, mode: "referral" },
      { direction: "mle", count: 2, mode: "direct" },
      { direction: "swe_general", count: 3, mode: "direct" },
    ]);
    expect(planTotals(counts)).toEqual({ referral: 1, direct: 5, total: 6 });
    expect(buildPlan(["mle"], {})).toEqual([]);
  });
});
