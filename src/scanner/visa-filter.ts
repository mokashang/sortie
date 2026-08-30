// 唯一允许关键词规则的环节(spec §4):黑白分明的签证硬过滤。
// 原则:只标记明确拒绝;模糊表述(如 "authorized to work")不误杀。
const NO_SPONSOR = [
  /unable to sponsor/i,
  /not (?:able|available) to sponsor/i,
  /cannot sponsor/i,
  /will not sponsor/i,
  /no (?:visa )?sponsorship/i,
  /sponsorship (?:is )?not (?:available|offered|provided)/i,
  /not eligible for (?:visa )?sponsorship/i,
  /without (?:the need for )?(?:visa )?sponsorship now and in the future/i,
];
const CITIZEN_ONLY = [
  /must be (?:a |an )?u\.?s\.? citizen/i,
  /u\.?s\.? citizen(?:ship)? (?:is )?(?:or green card )?required/i,
  /citizens? or (?:green card|permanent resident)s? only/i,
  /green card (?:holders? )?(?:or citizens? )?(?:is |are )?required/i,
];
const CLEARANCE = [/security clearance/i, /\bts\/sci\b/i, /(?:secret|top secret) clearance/i];

export type VisaFlag = "no_sponsor" | "citizen_only" | "clearance" | null;

export function visaFlag(jdText: string): VisaFlag {
  if (CLEARANCE.some((r) => r.test(jdText))) return "clearance";
  if (CITIZEN_ONLY.some((r) => r.test(jdText))) return "citizen_only";
  if (NO_SPONSOR.some((r) => r.test(jdText))) return "no_sponsor";
  return null;
}
