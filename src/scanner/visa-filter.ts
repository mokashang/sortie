// 唯一允许关键词规则的环节(spec §4):黑白分明的签证硬过滤。
// 原则:只标记明确拒绝;模糊表述(如 "authorized to work")不误杀。
//
// NO_SPONSOR: negation must bind directly to a sponsorship-provisioning verb, and never
// cross a line break, period, or semicolon — a bare "no"/"not" anywhere within N chars of
// "sponsor*" is not enough (e.g. "No prior experience required\n...we sponsor visas" must
// stay null; "do not require immediate sponsorship" must stay null since "require" isn't a
// provisioning verb).
const NO_SPONSOR = [
  // Negation binds to a sponsor VERB form directly (sponsor/sponsors/sponsoring/sponsored).
  // Load-bearing detail: \bsponsor(?:s|ing|ed)?\b can NEVER match the noun "sponsorship" —
  // the \b word boundary fails right before "ship" since "sponsor" and "ship" are contiguous
  // word characters with no boundary between them. That's what keeps phrasings like "do not
  // require immediate sponsorship" (negation binds to "require", and the only sponsor-word
  // present is the noun "sponsorship", which this pattern structurally can't reach) null,
  // while "unable to sponsor visas" (verb form present) still flags.
  /\b(?:do(?:es)? not|will not|cannot|can ?not|won'?t|unable to)\b[^.\n;]{0,20}\bsponsor(?:s|ing|ed)?\b/i,
  // "sponsorship ... not available/offered/provided/possible/supported"
  /\bsponsorship\b[^.\n;]{0,15}\bnot\s+(?:available|offered|provided|possible|supported)\b/i,
  // bare "no [visa/employment] sponsorship"
  /\bno\s+(?:visa\s+|employment\s+)?sponsorship\b/i,
  // "sponsorship (is) unavailable"
  /\bsponsorship\s+(?:is\s+)?unavailable\b/i,
  // "not sponsoring"
  /\bnot sponsoring\b/i,
  // Companion: negation + a provisioning verb (provide/offer/support/consider), then later
  // "sponsor(ship|ing)?" — needed because the noun "sponsorship" can't satisfy the verb-form
  // pattern above, e.g. "not able to provide visa sponsorship", "unable to provide
  // sponsorship now or in the future". Same clause only.
  /\b(?:unable|not able|cannot|can ?not|won'?t|will not|do(?:es)? not|not eligible)\b[^.\n;]{0,30}\b(?:provide|offer|support|consider)\w*[^.\n;]{0,25}\bsponsor(?:ship|ing)?\b/i,
  // Companion: "not eligible ... sponsorship" — "eligible for X" implies the direct object without needing a separate provisioning verb.
  /\bnot eligible\b[^.\n;]{0,30}\bsponsorship\b/i,
  // Companion: "must be authorized to work ... without ... sponsorship" style phrasing, same clause only.
  /\bwithout\b[^.\n;]{0,40}\bsponsorship\b/i,
];
const CITIZEN_ONLY = [
  /must be (?:a |an )?u\.?s\.? citizen/i,
  /u\.?s\.? citizen(?:ship)? (?:is )?(?:or green card )?required/i,
  /citizens? or (?:green card|permanent resident)s? only/i,
  /green card (?:holders? )?(?:or citizens? )?(?:is |are )?required/i,
];
// Only flag requirement-bearing clearance phrasing — never silent/friendly/negated mentions
// like "no clearance required", "does not require a clearance", "clearance is a plus", or
// "preference given to candidates with an active clearance". A clearance-type word
// (ts/sci|top secret|secret|security) directly followed by "clearance" counts as a
// requirement UNLESS it's negated or downgraded to a soft preference earlier in the same
// clause ("No security clearance...", "does not require a security clearance", "Preference
// given to candidates with an active security clearance") or reassured right after ("...
// clearance is a plus"). Deliberately omits a bare /clearance\s+required/i pattern — not
// because the lookbehind couldn't anchor to it, but because its coverage is marginal: the
// clearance-level word (ts/sci|top secret|secret|security) that would anchor a negation
// lookbehind almost always appears elsewhere in the same sentence anyway, so the
// trigger-anchored pattern below already catches these cases.
const CLEARANCE = [
  /(?<!\b(?:no|not|n't|without|preference|preferred|ideally|desirable|plus|nice to have|bonus)\b[^.\n;]{0,45})\b(?:ts\/sci|top secret|secret|security)\b[^.\n;]{0,20}\bclearance\b(?![^.\n;]{0,25}\b(?:not required|not necessary|is a plus|preferred)\b)/i,
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
