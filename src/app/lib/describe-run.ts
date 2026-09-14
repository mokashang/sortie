import type { Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";
import { directionLabel } from "@/matcher/directions";

// One line describing what a task was asked to do, from its stored options:
// "SWE (General) ×2 · MLE / Applied ML · 内推 ×1" / "恢复模式:…" / "前 40 个" / "找内推 · 岗位 #12, #13".
export function describeRun(kind: string, options: unknown, lang: Lang): string {
  if (!options || typeof options !== "object") return "";
  const t = messages[lang].runs;
  const o = options as {
    plan?: { direction: string; count: number; mode?: string }[];
    limit?: number;
    resume?: boolean;
    companies?: string[];
    jobIds?: number[];
    mode?: string;
  };
  const parts: string[] = [];
  if (o.resume) parts.push(kind === "apply" ? t.resumeApply : t.resume);
  if (Array.isArray(o.plan) && o.plan.length > 0) {
    parts.push(o.plan.map((p) => `${directionLabel(p.direction)}${p.mode === "referral" ? t.referralSuffix : ""} ×${p.count}`).join(" · "));
  } else if (o.limit != null) {
    parts.push(t.first(o.limit));
  }
  if (Array.isArray(o.jobIds) && o.jobIds.length > 0) {
    parts.push(`${o.mode === "referral" ? t.findReferral : t.applyDirect} · ${t.jobs(o.jobIds.map((id) => `#${id}`).join(", "))}`);
  }
  if (Array.isArray(o.companies) && o.companies.length > 0) parts.push(o.companies.join(", "));
  return parts.join(" · ");
}
