import { DB } from "@/lib/db";
import { outreachesForJobs } from "@/network/crm";
import { followupPlan } from "@/network/followup";

// When a company's referral hunt is over, without the user pressing a button (user, 2026-10-15:
// "自动完成所有延续步骤,包括自动使用内推投递,等等,直到投递成功"). Per company on the 内推进行中
// board, from what each contacted person has done so far:
//   someone said they will refer / did refer → 有内推了: apply now with their name (and the
//     email / link / code they gave) in the referral fields;
//   everyone contacted is out → apply directly. Out = said no or no headcount, two follow-ups
//     went unanswered, or the connection invite still isn't accepted after INVITE_OUT_DAYS;
//   nobody could be found at all → apply directly;
//   nothing settled MAX_WAIT_DAYS after the first message went out → apply directly anyway.
// The conversations go on after a direct apply: whatever they say later still gets an answer
// (followup.ts), there is just no more chasing. Choices the user made 2026-10-15: 14 days for an
// invite, no second round of new people, apply as soon as someone agrees, and tell the referrer
// once the application is in (followup.ts 'applied').

export const INVITE_OUT_DAYS = 14;
export const MAX_WAIT_DAYS = 30;
const DAY_MS = 86_400_000;

function ts(at: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : at.replace(" ", "T") + "Z");
}

export type ContactVerdict = "won" | "out" | "alive" | "unsent";

export interface ContactFacts {
  outreachId: number;
  status: string; // outreach.status
  stage: string | null; // outreach.referral_stage
  firstSentAt: string | null; // when our first message (note or DM) went out
  exhausted: boolean; // followup.ts: both nudges went unanswered
}

export function contactVerdict(c: ContactFacts, now: number): ContactVerdict {
  if (c.stage === "referred" || c.stage === "will_refer") return "won";
  if (c.stage === "declined" || c.stage === "no_headcount") return "out";
  if (c.status === "archived" || c.status === "no_response") return "out";
  if (c.status === "draft") return "unsent"; // waits on the user's approval; not a contact yet
  if (c.status === "sent") return c.firstSentAt && now - ts(c.firstSentAt) >= INVITE_OUT_DAYS * DAY_MS ? "out" : "alive";
  if (c.status === "accepted" || c.status === "replied") return c.exhausted ? "out" : "alive";
  return "alive"; // pending_send: about to go out
}

export type CompanyDecision =
  | { action: "won"; outreachId: number }
  | { action: "direct"; why: "all_out" | "no_contact" | "timeout" }
  // directAt: when it goes direct if nothing changes (the card says so); null = not known.
  | { action: "wait"; directAt: string | null };

export interface CompanyFacts {
  contacts: ContactFacts[];
  reachedAt: string | null; // earliest referral_reached_at of the company's jobs
  noContact: boolean; // the session reported nobody reachable
  claimLive: boolean; // the run that took these jobs is still queued/running
  now: number;
}

// Pure (tests/referral-auto.test.ts).
export function decideCompany(f: CompanyFacts): CompanyDecision {
  const judged = f.contacts.map((c) => ({ c, v: contactVerdict(c, f.now) }));
  const won = judged
    .filter((x) => x.v === "won")
    .sort((a, b) => Number(b.c.stage === "referred") - Number(a.c.stage === "referred") || b.c.outreachId - a.c.outreachId)[0];
  if (won) return { action: "won", outreachId: won.c.outreachId };

  const contacted = judged.filter((x) => x.v !== "unsent");
  if (contacted.length > 0 && contacted.every((x) => x.v === "out")) return { action: "direct", why: "all_out" };
  if (judged.length === 0 && (f.noContact || !f.claimLive)) return { action: "direct", why: "no_contact" };
  const since = f.reachedAt ? ts(f.reachedAt) : null;
  if (since != null && f.now - since >= MAX_WAIT_DAYS * DAY_MS) return { action: "direct", why: "timeout" };

  let at = since != null ? since + MAX_WAIT_DAYS * DAY_MS : null;
  const alive = contacted.filter((x) => x.v === "alive");
  // Only invites left waiting: it goes direct once the last of them runs out.
  if (alive.length > 0 && alive.every((x) => x.c.status === "sent" && x.c.firstSentAt)) {
    const outAt = Math.max(...alive.map((x) => ts(x.c.firstSentAt!) + INVITE_OUT_DAYS * DAY_MS));
    at = at == null ? outAt : Math.min(at, outAt);
  }
  return { action: "wait", directAt: at != null ? new Date(at).toISOString() : null };
}

export interface SeekingJob {
  jobId: number;
  reachedAt: string | null;
  noContactReason: string | null;
  runStatus: string | null; // status of the run that took the job (applications.run_id)
}

// What decideCompany needs, read from the DB for one company's referral_seeking jobs.
export function companyFacts(db: DB, userId: string, jobs: SeekingJob[], now: number): CompanyFacts {
  const contacts = outreachesForJobs(
    db,
    userId,
    jobs.map((j) => j.jobId)
  ).flatMap((o): ContactFacts[] => {
    const firstSentAt = o.threadLog.find((t) => t.dir === "sent")?.at ?? null;
    if (o.status === "archived" && !firstSentAt) return []; // a draft the user turned down
    const plan = o.status === "accepted" || o.status === "replied" ? followupPlan(db, userId, o.id, now) : null;
    return [
      {
        outreachId: o.id,
        status: o.status,
        stage: o.referralStage,
        firstSentAt,
        exhausted: plan?.action === "none" && plan.reason === "exhausted",
      },
    ];
  });
  return {
    contacts,
    reachedAt: jobs.map((j) => j.reachedAt).filter((x): x is string => !!x).sort()[0] ?? null,
    noContact: jobs.some((j) => !!j.noContactReason?.startsWith("no contact found")),
    claimLive: jobs.some((j) => j.runStatus === "queued" || j.runStatus === "running"),
    now,
  };
}
