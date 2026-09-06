import { directionLabel } from "@/matcher/directions";

// One line describing what a task was asked to do, from its stored options:
// "SWE (General) ×2 · MLE / Applied ML · 内推 ×1" / "恢复模式:…" / "前 40 个" / "找内推 · 岗位 #12, #13".
export function describeRun(kind: string, options: unknown): string {
  if (!options || typeof options !== "object") return "";
  const o = options as {
    plan?: { direction: string; count: number; mode?: string }[];
    limit?: number;
    resume?: boolean;
    companies?: string[];
    jobIds?: number[];
    mode?: string;
  };
  const parts: string[] = [];
  if (o.resume) parts.push(kind === "apply" ? "恢复模式:补提交已批准的申请" : "恢复模式");
  if (Array.isArray(o.plan) && o.plan.length > 0) {
    parts.push(o.plan.map((p) => `${directionLabel(p.direction)}${p.mode === "referral" ? " · 内推" : ""} ×${p.count}`).join(" · "));
  } else if (o.limit != null) {
    parts.push(`前 ${o.limit} 个`);
  }
  if (Array.isArray(o.jobIds) && o.jobIds.length > 0) {
    parts.push(`${o.mode === "referral" ? "找内推" : "直接投"} · 岗位 ${o.jobIds.map((id) => `#${id}`).join(", ")}`);
  }
  if (Array.isArray(o.companies) && o.companies.length > 0) parts.push(o.companies.join(", "));
  return parts.join(" · ");
}
