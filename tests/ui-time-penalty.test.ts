import { describe, it, expect } from "vitest";
import { timePenalty, timePenaltyNote, TIME_PENALTY_RULE } from "@/app/lib/time-penalty";

describe("ui time penalty", () => {
  it("integer and fractional ages give the same penalty (thresholds are whole days)", () => {
    for (let d = 0; d < 120; d++) {
      for (const f of [0, 0.2, 0.5, 0.99]) {
        expect(timePenalty(d + f, false)).toBe(timePenalty(d, false));
        expect(timePenalty(d + f, true)).toBe(timePenalty(d, true));
      }
    }
  });
  it("never exceeds the caps and never goes negative", () => {
    expect(timePenalty(-5, false)).toBe(0);
    expect(timePenalty(10_000, false)).toBe(TIME_PENALTY_RULE.capPoints);
    expect(timePenalty(10_000, true)).toBe(TIME_PENALTY_RULE.bigCapPoints);
  });
  it("notes explain the three cases in plain words", () => {
    expect(timePenaltyNote(3, false)).toBe("发布 14 天内,排序不扣分");
    expect(timePenaltyNote(36, false)).toBe("发布 36 天,排序时扣 4 分(14 天内不扣,之后每 5 天扣 1 分,封顶 10)");
    expect(timePenaltyNote(36, true)).toBe("发布 36 天,排序时扣 2 分(14 天内不扣,之后知名公司减半,每 10 天扣 1 分,封顶 5)");
    expect(timePenaltyNote(null, false)).toBe("来源没给发布日期,排序时按 30 天算,扣 3 分(每 5 天扣 1 分,封顶 10)");
    expect(timePenaltyNote(null, true)).toBe("来源没给发布日期,排序时按 30 天算,扣 1 分(知名公司减半,每 10 天扣 1 分,封顶 5)");
  });
});
