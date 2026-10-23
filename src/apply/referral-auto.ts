import { DB, logEvent } from "@/lib/db";
import { referralDecide, ReferralInfo } from "@/apply/referral";
import { companyFacts, decideCompany, SeekingJob } from "@/apply/referral-policy";
import { maybeAutoStartApply, DecideAutoStartDeps, DecideAutoStartResult } from "@/apply/decide-auto-start";
import { enqueueReferralCheck } from "@/apply/referral-check";
import type { startExecutor } from "@/executor/runner";
import { listUsers } from "@/lib/users";
import { notifyUser } from "@/lib/notify-user";
import { serverLang } from "@/lib/prefs";
import { messages } from "@/i18n/messages";

// The App settles each company's referral hunt itself (rules in referral-policy.ts) — what the
// 有内推了 / 直接投 buttons on the 内推进行中 card used to wait for. Runs after every harvest, when
// the session reports nobody reachable, and every ten minutes from the referral tick (the
// 14-day and 30-day clocks). Both outcomes queue a targeted apply run for the jobs
// ({jobIds, mode:'direct'} — a referral_ready job carries its referral in the answer pack), so
// the chain goes on to a submitted application; with 自动投递 on nobody has to click anything.

export interface ResolveOutcome {
  company: string;
  jobIds: number[];
  action: "won" | "direct";
  why?: "all_out" | "no_contact" | "timeout";
  personName?: string;
  runId?: number;
}

export interface ResolveDeps {
  now?: () => number;
  startApply?: (db: DB, userId: string, jobIds: number[]) => DecideAutoStartResult;
  autoStart?: DecideAutoStartDeps;
  notify?: (title: string, body: string) => void;
}

// What goes in the answer pack's referral section, from the conversation that won it. The
// classifier's `link` holds whatever the referrer handed over: a URL to open instead of the job
// page, an address to list as referrer, or a code.
export function referralInfoFor(db: DB, userId: string, outreachId: number): { info: Omit<ReferralInfo, "at">; personId: number; personName: string } {
  const o = db
    .prepare(
      `SELECT o.stage_link, o.person_id, p.name, p.role_title, p.company FROM outreach o JOIN people p ON p.id = o.person_id
       WHERE o.user_id = ? AND o.id = ?`
    )
    .get(userId, outreachId) as { stage_link: string | null; person_id: number; name: string; role_title: string | null; company: string | null };
  const given = (o.stage_link ?? "").trim();
  const info: Omit<ReferralInfo, "at"> = { source: "linkedin" };
  if (/^https?:\/\//i.test(given)) info.link = given;
  else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(given)) info.email = given;
  else if (given && given.length <= 64 && !/\s/.test(given)) info.code = given;
  info.note = `Referred by ${o.name}${o.role_title ? `, ${o.role_title}` : ""}${o.company ? ` at ${o.company}` : ""} (agreed on LinkedIn)${
    info.email ? `; referrer email ${info.email}` : ""
  }`;
  return { info, personId: o.person_id, personName: o.name };
}

export function resolveReferrals(db: DB, userId: string, deps: ResolveDeps = {}): ResolveOutcome[] {
  const now = deps.now?.() ?? Date.now();
  const rows = db
    .prepare(
      `SELECT a.job_id, j.company, a.referral_reached_at, a.needs_manual_reason, r.status AS run_status
       FROM applications a JOIN jobs j ON j.id = a.job_id LEFT JOIN executor_runs r ON r.id = a.run_id
       WHERE a.user_id = ? AND a.status = 'referral_seeking' ORDER BY a.job_id`
    )
    .all(userId) as { job_id: number; company: string; referral_reached_at: string | null; needs_manual_reason: string | null; run_status: string | null }[];
  const byCompany = new Map<string, { company: string; jobs: SeekingJob[] }>();
  for (const r of rows) {
    const key = r.company.toLowerCase();
    const g = byCompany.get(key) ?? { company: r.company, jobs: [] };
    g.jobs.push({ jobId: r.job_id, reachedAt: r.referral_reached_at, noContactReason: r.needs_manual_reason, runStatus: r.run_status });
    byCompany.set(key, g);
  }

  const lang = serverLang();
  const t = messages[lang].notify.referral;
  const push = deps.notify ?? ((title: string, body: string) => void notifyUser(db, userId, title, body, { priority: "default" }));
  const start = deps.startApply ?? ((d: DB, u: string, jobIds: number[]) => maybeAutoStartApply(d, u, { jobIds, mode: "direct" }, deps.autoStart));
  const out: ResolveOutcome[] = [];
  for (const { company, jobs } of byCompany.values()) {
    const decision = decideCompany(companyFacts(db, userId, jobs, now));
    if (decision.action === "wait") continue;
    const jobIds = jobs.map((j) => j.jobId);
    try {
      let outcome: ResolveOutcome;
      if (decision.action === "won") {
        const { info, personId, personName } = referralInfoFor(db, userId, decision.outreachId);
        referralDecide(db, userId, { jobIds, action: "won", info, personId });
        outcome = { company, jobIds, action: "won", personName };
        push(t.autoWon.title(company), t.autoWon.body(personName, jobIds.length));
      } else {
        referralDecide(db, userId, { jobIds, action: "direct" });
        outcome = { company, jobIds, action: "direct", why: decision.why };
        push(t.autoDirect.title(company), t.autoDirect.body(jobIds.length, decision.why));
      }
      const started = start(db, userId, jobIds);
      if (started.runId != null) outcome.runId = started.runId;
      logEvent(db, "referral_auto_resolved", { userId, entity: "application", payload: { ...outcome } });
      out.push(outcome);
    } catch (e) {
      logEvent(db, "referral_auto_error", { userId, entity: "application", payload: { company, jobIds, error: String(e) } });
    }
  }
  return out;
}

export function resolveReferralsForAll(db: DB, deps: ResolveDeps = {}): ResolveOutcome[] {
  return listUsers(db).flatMap((u) => {
    try {
      return resolveReferrals(db, u.id, deps);
    } catch {
      return [];
    }
  });
}

// POST /api/apply/report submitted: an application that went in with a referral → check the
// referrer's thread soon, so the 'applied' follow-up (followup.ts) tells them it's in today
// rather than at the next scheduled check. Returns the queued run id or null; never throws.
export function afterReferralSubmitted(db: DB, userId: string, jobId: number, deps: { startExecutor?: typeof startExecutor } = {}): number | null {
  try {
    const row = db
      .prepare("SELECT referral_person_id, referral_info FROM applications WHERE user_id = ? AND job_id = ?")
      .get(userId, jobId) as { referral_person_id: number | null; referral_info: string | null } | undefined;
    if (!row?.referral_person_id || !row.referral_info) return null;
    return enqueueReferralCheck(db, userId, deps);
  } catch {
    return null;
  }
}
