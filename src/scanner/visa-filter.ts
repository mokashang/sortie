// 唯一允许关键词规则的环节(spec §4):黑白分明的签证硬过滤。
// 原则:只标记明确拒绝;模糊表述(如 "authorized to work")不误杀。
//
// NO_SPONSOR: negation must bind directly to a sponsorship-provisioning verb, and never
// cross a line break, period, or semicolon — a bare "no"/"not" anywhere within N chars of
// "sponsor*" is not enough (e.g. "No prior experience required\n...we sponsor visas" must
// stay null; "do not require immediate sponsorship" must stay null since "require" isn't a
// provisioning verb).
const NO_SPONSOR = [
  // negation + a provisioning verb (provide/offer/support/consider), then later "sponsor(ship|ing)?" — same clause only.
  /\b(?:unable|not able|cannot|can ?not|won'?t|will not|do(?:es)? not|not eligible)\b[^.\n;]{0,30}\b(?:provide|offer|support|consider)\w*[^.\n;]{0,25}\bsponsor(?:ship|ing)?\b/i,
  // "not eligible ... sponsorship" — "eligible for X" implies the direct object without needing a separate provisioning verb.
  /\bnot eligible\b[^.\n;]{0,30}\bsponsorship\b/i,
  // negation binds directly to "sponsor" as the verb itself — tight window so another verb (e.g. "require") can't sneak in between.
  /\b(?:unable|not able|cannot|can ?not|won'?t|will not|do(?:es)? not|not eligible)\b\s*(?:to\s+|for\s+)?\bsponsor(?:s|ing|ed)?\b/i,
  // "must be authorized to work ... without ... sponsorship" style phrasing, same clause only.
  /\bwithout\b[^.\n;]{0,40}\bsponsorship\b/i,
];
const CITIZEN_ONLY = [
  /must be (?:a |an )?u\.?s\.? citizen/i,
  /u\.?s\.? citizen(?:ship)? (?:is )?(?:or green card )?required/i,
  /citizens? or (?:green card|permanent resident)s? only/i,
  /green card (?:holders? )?(?:or citizens? )?(?:is |are )?required/i,
];
// Only flag requirement-bearing clearance phrasing — never silent/friendly/negated mentions
// like "no clearance required", "does not require a clearance", or "clearance is a plus".
// A clearance-type word (ts/sci|top secret|secret|security) directly followed by "clearance"
// counts as a requirement UNLESS it's negated earlier in the same clause ("No security
// clearance...", "does not require a security clearance") or reassured right after ("...
// clearance is a plus"). Deliberately omits a bare /clearance\s+required/i pattern — without
// a clearance-type trigger word to anchor the negation lookbehind to, that pattern can't tell
// "No security clearance is required" (null) from "Secret clearance required" (flag).
const CLEARANCE = [
  /(?<!\b(?:no|not|n't|without)\b[^.\n;]{0,20})\b(?:ts\/sci|top secret|secret|security)\b[^.\n;]{0,20}\bclearance\b(?![^.\n;]{0,25}\b(?:not required|not necessary|is a plus|preferred)\b)/i,
  // "must have/hold/possess/be able to obtain ... clearance" — same clause only.
  /\bmust (?:have|hold|possess|be able to obtain)\b[^.\n;]{0,40}\bclearance\b/i,
  // TS/SCI-with-polygraph phrasing that has no literal "clearance" word.
  /\bts\/sci\b[^.\n;]{0,25}\bpolygraph\b/i,
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
