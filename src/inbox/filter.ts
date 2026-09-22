// The free pre-filter in front of the classifier (spec 2026-09-21 inbox-sync §5 step 4). A
// mailbox gets far more newsletters, receipts and job alerts than recruiting mail; sending all
// of it to a model would be slow and pointless. A mail goes on to the classifier when any of:
//   - it comes from a known applicant-tracking / assessment / scheduling domain
//   - its sender, subject or body names one of the companies the user has applied to
//   - its subject reads like recruiting mail (application / interview / assessment / offer …)
// Everything else is dropped without being stored. The filter is deliberately generous — a
// false positive costs one classifier slot, a false negative loses a result. Job-alert senders
// (LinkedIn, Handshake, Simplify …) are NOT on the domain list on purpose: their daily digests
// would otherwise all go to the model; a real recruiter mail from them still passes on subject
// or company name.

import { domainOf } from "@/inbox/google";

export const ATS_DOMAINS = [
  "greenhouse.io",
  "greenhouse-mail.io",
  "lever.co",
  "hire.lever.co",
  "ashbyhq.com",
  "myworkday.com",
  "workday.com",
  "workdaymail.com",
  "icims.com",
  "smartrecruiters.com",
  "jobvite.com",
  "successfactors.com",
  "sap.com",
  "taleo.net",
  "oraclecloud.com",
  "oracle.com",
  "brassring.com",
  "workable.com",
  "workablemail.com",
  "bamboohr.com",
  "rippling.com",
  "breezy.hr",
  "recruitee.com",
  "jazz.co",
  "applytojob.com",
  "hirevue.com",
  "hackerrank.com",
  "hackerrankforwork.com",
  "codesignal.com",
  "codility.com",
  "karat.com",
  "coderpad.io",
  "goodtime.io",
  "calendly.com",
  "modernloop.io",
  "gem.com",
  "amazon.jobs",
  "myworkdayjobs.com",
  "eightfold.ai",
  "phenom.com",
  "phenompeople.com",
  "avature.net",
  "ultipro.com",
  "ukg.com",
  "dayforce.com",
  "paylocity.com",
  "paycomonline.net",
];

export const RECRUITING_SUBJECT = new RegExp(
  "\\b(" +
    [
      "applications?",
      "applied",
      "applying",
      "interviews?",
      "interviewing",
      "assessment",
      "coding challenge",
      "online test",
      "take-?home",
      "hackerrank",
      "codesignal",
      "offer",
      "candidate",
      "candidacy",
      "position",
      "role",
      "recruit(?:er|ing|ment)?",
      "hiring",
      "next steps?",
      "phone screen",
      "screening",
      "on-?site",
      "update on",
      "decision",
      "regret",
      "unfortunately",
      "move forward",
      "moving forward",
      "thank you for (?:applying|your interest)",
      "background check",
      "onboarding",
    ].join("|") +
    ")\\b",
  "i"
);

// Words that appear in company names but identify nothing on their own.
const GENERIC = new Set([
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
  "companies",
  "group",
  "labs",
  "lab",
  "technologies",
  "technology",
  "tech",
  "systems",
  "software",
  "solutions",
  "services",
  "capital",
  "partners",
  "holdings",
  "global",
  "international",
  "the",
  "and",
  "of",
  "for",
  "usa",
  "us",
  "america",
  "american",
  "north",
  "energy",
  "health",
  "digital",
  "data",
  "cloud",
  "network",
  "networks",
  "ai",
  "research",
  "security",
  "robotics",
  "mobility",
  "financial",
  "finance",
  "bank",
  "trading",
  "media",
  "games",
  "studio",
  "studios",
  "ventures",
  "team",
  "careers",
  "jobs",
  "university",
  "college",
]);

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The phrases that identify a company in free text: its whole normalized name, plus its first
// distinctive word when the name has several (so "Scale AI" is also found as "Scale", and
// "Datadog, Inc." as "datadog"). Single generic or short words are dropped.
export function companyPhrases(companies: string[]): string[] {
  const out = new Set<string>();
  for (const raw of companies) {
    const full = normalizeName(raw);
    if (!full) continue;
    const words = full.split(" ").filter((w) => !GENERIC.has(w));
    if (words.length === 0) continue;
    const trimmed = words.join(" ");
    if (trimmed.length >= 3) out.add(trimmed);
    const first = words[0];
    if (first.length >= 4 && !GENERIC.has(first)) out.add(first);
  }
  return [...out];
}

export function phraseRegex(phrase: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`, "i");
}

export interface CandidateVerdict {
  keep: boolean;
  reason: "ats" | "company" | "subject" | "none";
  company?: string;
}

// `companies` = names of the user's submitted applications. `text` may be long; only the first
// few thousand characters are searched, which is where a recruiting mail names the company.
export function isCandidateMail(mail: { from: string; subject: string; text: string }, companies: string[]): CandidateVerdict {
  const domain = domainOf(mail.from);
  if (domain && ATS_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return { keep: true, reason: "ats" };
  const haystack = `${mail.from}\n${mail.subject}\n${mail.text.slice(0, 4000)}`;
  for (const phrase of companyPhrases(companies)) {
    if (phraseRegex(phrase).test(haystack)) return { keep: true, reason: "company", company: phrase };
  }
  if (RECRUITING_SUBJECT.test(mail.subject)) return { keep: true, reason: "subject" };
  return { keep: false, reason: "none" };
}
