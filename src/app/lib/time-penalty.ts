// 队列排序用的时间惩罚规则(spec 2026-09-06 job-sources §5.2;2026-09-11 放宽)。纯常量 + 纯函数,客户端可用;
// SQL 版在 src/apply/rank.ts 由这里的常量拼出来,tests/rank.test.ts 断言两边逐天一致。
//
// 为什么放宽(用户 2026-09-11):知名公司的岗位(Workday / Oracle 那类门户、字节 TikTok 门户)常常一挂就是
// 两三个月而且滚动招聘,开了 30 天依然值得优先投;原规则(7 天后每 4 天扣 1,封顶 15)会把一条 89 分、
// 36 天的 ByteDance 岗压到一堆刚发的 80 分小公司岗后面(AI infra 方向第 17 名)。现在:
//   - 所有岗位发布 14 天内不扣;之后每 5 天扣 1 分,封顶 10(约 64 天到顶);
//   - 助手判为「建议内推」的知名公司岗位(matches.referral_fit = 1,即 分≥75 且 大厂/知名)减半:
//     每 10 天扣 1 分,封顶 5——30 天只扣 1,60 天扣 4;
//   - 来源没给发布日期的按 30 天算(小公司扣 3,知名公司扣 1)。
// 惩罚只影响排序,不改 matches.score;页面仍显示原始分,详情抽屉里另给「排序用综合分」和扣分说明。
export const TIME_PENALTY_RULE = {
  graceDays: 14,
  stepDays: 5,
  capPoints: 10,
  bigStepDays: 10,
  bigCapPoints: 5,
  unknownAgeDays: 30,
} as const;

// 与 src/apply/rank.ts 的 TIME_PENALTY_SQL 完全等价的 TS 版。ageDays 可以是整数天(relativeDays().days),
// 也可以是实数天:阈值都是整数,floor((n+f-14)/5) 与 floor((n-14)/5) 恒相等,所以两种输入结果一致。
export function timePenalty(ageDays: number | null, bigCompany: boolean): number {
  const R = TIME_PENALTY_RULE;
  const age = ageDays ?? R.unknownAgeDays;
  const step = bigCompany ? R.bigStepDays : R.stepDays;
  const cap = bigCompany ? R.bigCapPoints : R.capPoints;
  return Math.min(cap, Math.max(0, Math.floor((age - R.graceDays) / step)));
}

// 详情抽屉 / 行内提示用的一句话说明。
export function timePenaltyNote(ageDays: number | null, bigCompany: boolean): string {
  const R = TIME_PENALTY_RULE;
  const p = timePenalty(ageDays, bigCompany);
  const rule = bigCompany
    ? `知名公司减半,每 ${R.bigStepDays} 天扣 1 分,封顶 ${R.bigCapPoints}`
    : `每 ${R.stepDays} 天扣 1 分,封顶 ${R.capPoints}`;
  if (ageDays == null) return `来源没给发布日期,排序时按 ${R.unknownAgeDays} 天算,扣 ${p} 分(${rule})`;
  if (p === 0) return `发布 ${R.graceDays} 天内,排序不扣分`;
  return `发布 ${ageDays} 天,排序时扣 ${p} 分(${R.graceDays} 天内不扣,之后${rule})`;
}
