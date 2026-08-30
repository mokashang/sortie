// 唯一允许关键词规则的环节(spec §4):黑白分明的签证硬过滤。
// 原则:只标记明确拒绝;模糊表述(如 "authorized to work")不误杀。
const NO_SPONSOR = [
  // "not/no/unable/cannot/won't/do(es) not ... sponsor(ship/ing)" within a short window,
  // e.g. "unable to sponsor", "does not provide sponsorship", "not eligible for ... sponsorship".
  /(?:not|no|unable|cannot|won'?t|do(?:es)? not)\b[^.]{0,60}\bsponsor(?:ship|ing)?\b/i,
  // "must be authorized to work ... without ... sponsorship" style phrasing.
  /without[^.]{0,40}sponsorship/i,
];
const CITIZEN_ONLY = [
  /must be (?:a |an )?u\.?s\.? citizen/i,
  /u\.?s\.? citizen(?:ship)? (?:is )?(?:or green card )?required/i,
  /citizens? or (?:green card|permanent resident)s? only/i,
  /green card (?:holders? )?(?:or citizens? )?(?:is |are )?required/i,
];
// Only flag requirement-bearing clearance phrasing — never silent/friendly/negated mentions
// like "no clearance required", "does not require a clearance", or "clearance is a plus".
const CLEARANCE = [
  /(?:active|current|existing)\s+(?:ts\/sci\s+)?(?:security\s+)?clearance\s+(?:is\s+)?required/i,
  /must (?:have|hold|possess|be able to obtain)[^.]{0,40}clearance/i,
];

export type VisaFlag = "no_sponsor" | "citizen_only" | "clearance" | null;

export function visaFlag(jdText: string | null | undefined): VisaFlag {
  if (!jdText) return null;
  // Most actionable label wins: an explicit non-sponsorship statement is the strongest
  // signal, then citizenship-only, then clearance.
  if (NO_SPONSOR.some((r) => r.test(jdText))) return "no_sponsor";
  if (CITIZEN_ONLY.some((r) => r.test(jdText))) return "citizen_only";
  if (CLEARANCE.some((r) => r.test(jdText))) return "clearance";
  return null;
}
