import { DB } from "@/lib/db";

// Nothing the App writes in the candidate's name may say an application went in, or that a hiring
// process moved, unless the App's own records say so. 2026-11-04: the nudge prompt told the model
// to "add one small new thing (you've now applied…)" while it had no way to see applications, and
// with 自动投递 on nobody read the result: 17 messages to 16 people claimed roles that were never
// submitted, one turned down a real referral ("I actually did submit it already"), and one was
// about to say "I've since heard back from OpenAI and am moving forward in the process".
//
// Two layers, like links.ts: the prompt carries the records and the rule, and unsupportedClaims
// reads the finished draft, because a rule in a prompt is exactly what failed here. A draft that
// fails twice is not sent on its own: it waits on the card for the user.

export interface ApplicationRecord {
  company: string;
  title: string;
  status: string;
}

export interface ApplicationRecords {
  // Everything submitted at the companies this conversation is about, these roles or others.
  submitted: ApplicationRecord[];
  // The roles this conversation is about that have not gone in.
  notSubmitted: { company: string; title: string }[];
}

export const NO_RECORDS: ApplicationRecords = { submitted: [], notSubmitted: [] };

const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function applicationRecords(db: DB, userId: string, jobIds: number[]): ApplicationRecords {
  if (jobIds.length === 0) return NO_RECORDS;
  const linked = db
    .prepare(
      `SELECT j.company, j.title, a.submitted_at FROM jobs j LEFT JOIN applications a ON a.job_id = j.id AND a.user_id = ?
       WHERE j.id IN (${jobIds.map(() => "?").join(",")})`
    )
    .all(userId, ...jobIds) as { company: string; title: string; submitted_at: string | null }[];
  const companies = Array.from(new Set(linked.map((j) => j.company.toLowerCase())));
  if (companies.length === 0) return NO_RECORDS;
  const submitted = db
    .prepare(
      `SELECT j.company, j.title, a.status FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = ? AND a.submitted_at IS NOT NULL AND lower(j.company) IN (${companies.map(() => "?").join(",")})
       ORDER BY a.submitted_at ASC`
    )
    .all(userId, ...companies) as ApplicationRecord[];
  // A role deduped into another posting of the same title went in under that posting.
  const notSubmitted = linked
    .filter((j) => !j.submitted_at && !submitted.some((s) => sameTitle(s.title, j.title)))
    .map((j) => ({ company: j.company, title: j.title }));
  return { submitted, notSubmitted };
}

// Shared by the first message and everything after it.
export const APPLICATION_RULE =
  "Your applications: the Application records below are the only evidence. Say you've applied only to a role listed there under Submitted, using its title. Never say or imply that any other role is applied to, submitted or in the system, even if an earlier message in the conversation says so — those can be wrong. Saying you're applying or plan to apply is fine. Say you heard back, have an interview or are moving forward only if that role's status there is oa, interview or offer. Don't bring up a rejection. If they ask whether you've applied, answer truthfully from the records.";

export function recordsBlock(records: ApplicationRecords): string {
  const lines = ["Application records (the App's own database):"];
  if (records.submitted.length === 0) lines.push("Submitted: none");
  else lines.push("Submitted:", ...records.submitted.map((s) => `- ${s.company}: ${s.title} (status: ${s.status})`));
  if (records.notSubmitted.length > 0) lines.push("Not submitted yet:", ...records.notSubmitted.map((j) => `- ${j.company}: ${j.title}`));
  return lines.join("\n");
}

export function badClaimsNote(claims: string[]): string {
  return `Your previous draft said things the Application records don't support: ${claims
    .map((c) => `"${c}"`)
    .join(" ")} Rewrite the message without them, following the rule about your applications.`;
}

const W = "[a-z'’-]+\\s+"; // one filler word
const AFTER_APPLIED = "(?=\\s+(?:to|for|through|via|on|online|directly|already|last|yesterday|today|earlier|and)\\b|\\s*[.,!;:—–-]|\\s*$)";

// "I've gone ahead and applied", "I just submitted my application", "my application is in".
const APPLIED_CLAIMS = [
  new RegExp(`\\bi(?:['’]ve| have)?\\s+(?:${W}){0,4}?applied${AFTER_APPLIED}`, "i"),
  new RegExp(`\\b(?:just|already|recently|now|also|since)\\s+applied${AFTER_APPLIED}`, "i"),
  /^applied\s+(?:to|for)\b/i,
  new RegExp(`\\bi(?:['’]ve| have)?\\s+(?:${W}){0,3}?(?:submitted|sent in|put in)\\s+(?:${W}){0,3}?(?:applications?\\b|apps?\\b|it\\b|them\\b|both\\b|all\\b|resume\\b|résumé\\b)`, "i"),
  new RegExp(`\\bi\\s+(?:${W}){0,2}?did\\s+(?:submit|apply)\\b`, "i"),
  /\b(?:went|gone) ahead and (?:applied|submitted)\b/i,
  /\b(?:got|put) (?:my|an|the) applications? in\b/i,
  new RegExp(`\\b(?:applications?|apps?)\\s+(?:${W}){0,2}?(?:is|are|was|were|went|has gone|have gone|has been|have been)\\s+(?:${W}){0,2}?(?:in|submitted|through)\\b`, "i"),
  /\bin (?:the|your|their) system\b/i,
];

// "I've since heard back and am moving forward in the process", "I have an interview next week".
const PROGRESS_CLAIMS = [
  /\bheard back\b/i,
  /\bmov(?:ing|ed|e) (?:forward|ahead)\b[^.!?]{0,40}\b(?:process|round|interview|stage|pipeline|loop)\b/i,
  new RegExp(`\\b(?:got|have|had|received|scheduled|passed|finished|completed|cleared)\\s+(?:${W}){0,2}?(?:interviews?|oa|online assessment|phone screen|recruiter (?:call|screen)|offers?)\\b`, "i"),
  /\b(?:next|final|second|onsite|technical)\s+(?:round|interview)s?\b/i,
];

const PROGRESSED = new Set(["oa", "interview", "offer", "offer_accepted", "offer_declined"]);

// A promise or a negation, not a claim: "once I've applied", "if my application is in",
// "I have not applied", "haven't heard back".
const NOT_YET_BEFORE = /(?:\b(?:once|after|when|as soon as|before|until|if|whether)\s+(?:[a-z'’-]+\s+){0,2}|(?:n['’]t|\bnot|\bnever|\bwithout)\s+(?:[a-z'’-]+\s+){0,2})$/i;
const NOT_YET_INSIDE = /\b(?:not|never|to|will)\b|n['’]t\b|['’]ll\b/i;

function claims(sentence: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => {
    const m = p.exec(sentence);
    return !!m && !NOT_YET_BEFORE.test(sentence.slice(0, m.index)) && !NOT_YET_INSIDE.test(m[0].replace(/\s+(?:to|for)$/i, ""));
  });
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const GENERIC = new Set(
  "a an the and or of for in at to on with i ii iii iv 1 2 3 us usa new grad graduate college early career intern internship engineer software senior junior level role remote onsite hybrid summer fall winter spring 2025 2026 2027 2028".split(
    " "
  )
);
const wordsOf = (s: string) => s.toLowerCase().match(/[a-z0-9+#]+/g) ?? [];

// Does the text name this role? Models shorten titles, so most of its telling words are enough.
function namesRole(text: string, title: string, distinctiveOnly = false): boolean {
  const said = new Set(wordsOf(text));
  const all = wordsOf(title);
  const key = all.filter((w) => !GENERIC.has(w));
  if (key.length === 0 && distinctiveOnly) return false;
  const need = key.length > 0 ? key : all;
  return need.length > 0 && need.filter((w) => said.has(w)).length >= Math.ceil(need.length * 0.6);
}

// The sentences of a draft that claim more than the records show.
export function unsupportedClaims(text: string, records: ApplicationRecords): string[] {
  const { submitted, notSubmitted } = records;
  const moved = submitted.some((s) => PROGRESSED.has(s.status));
  // "I've applied to both" is only true of everything; otherwise the message has to say which.
  const saysWhich = notSubmitted.length === 0 || submitted.some((s) => namesRole(text, s.title));
  return sentencesOf(text).filter((s) => {
    if (claims(s, PROGRESS_CLAIMS) && !moved) return true;
    if (!claims(s, APPLIED_CLAIMS)) return false;
    return submitted.length === 0 || !saysWhich || notSubmitted.some((j) => namesRole(s, j.title, true));
  });
}
