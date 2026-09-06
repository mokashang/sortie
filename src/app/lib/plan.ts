// The per-direction apply plan the 投递 page sends to POST /api/executor/start as options.plan.
// Referral entries come first so the attended session seeks referrals before mass-applying.
export type ApplyMode = "referral" | "direct";

export interface PlanEntry {
  direction: string;
  count: number;
  mode: ApplyMode;
}

export type PlanCounts = Record<string, { referral: number; direct: number }>;

export function clampCount(value: unknown, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(max, Math.floor(n)));
}

export function buildPlan(order: string[], counts: PlanCounts): PlanEntry[] {
  const plan: PlanEntry[] = [];
  for (const direction of order) {
    const c = counts[direction];
    if (c?.referral) plan.push({ direction, count: c.referral, mode: "referral" });
  }
  for (const direction of order) {
    const c = counts[direction];
    if (c?.direct) plan.push({ direction, count: c.direct, mode: "direct" });
  }
  return plan;
}

export function planTotals(counts: PlanCounts): { referral: number; direct: number; total: number } {
  let referral = 0;
  let direct = 0;
  for (const c of Object.values(counts)) {
    referral += c.referral;
    direct += c.direct;
  }
  return { referral, direct, total: referral + direct };
}
