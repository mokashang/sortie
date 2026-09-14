import { defineMessages } from "../define";

// The one-line explanation of the queue's time penalty (src/app/lib/time-penalty.ts).
export const rank = defineMessages({
  zh: {
    penalty: {
      rule: (stepDays: number, cap: number) => `每 ${stepDays} 天扣 1 分,封顶 ${cap}`,
      ruleBig: (stepDays: number, cap: number) => `知名公司减半,每 ${stepDays} 天扣 1 分,封顶 ${cap}`,
      unknownAge: (assumedDays: number, points: number, rule: string) => `来源没给发布日期,排序时按 ${assumedDays} 天算,扣 ${points} 分(${rule})`,
      withinGrace: (graceDays: number) => `发布 ${graceDays} 天内,排序不扣分`,
      aged: (ageDays: number, points: number, graceDays: number, rule: string) => `发布 ${ageDays} 天,排序时扣 ${points} 分(${graceDays} 天内不扣,之后${rule})`,
    },
  },
  en: {
    penalty: {
      rule: (stepDays: number, cap: number) => `1 point per ${stepDays} days, capped at ${cap}`,
      ruleBig: (stepDays: number, cap: number) => `halved for well-known companies: 1 point per ${stepDays} days, capped at ${cap}`,
      unknownAge: (assumedDays: number, points: number, rule: string) =>
        `The source gave no posting date, so ranking assumes ${assumedDays} days: −${points} (${rule})`,
      withinGrace: (graceDays: number) => `Posted within ${graceDays} days, no ranking penalty`,
      aged: (ageDays: number, points: number, graceDays: number, rule: string) =>
        `Posted ${ageDays} days ago, −${points} for ranking (none within ${graceDays} days, then ${rule})`,
    },
  },
});
