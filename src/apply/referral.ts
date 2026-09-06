import { DB, logEvent } from "@/lib/db";
import { Profile } from "@/lib/profile";
import { LlmBackend } from "@/llm/types";
import { EFFECTIVE_MODE_SQL } from "@/apply/mode";
import { upsertPerson, PersonInput, Channel, outreachesForJobs, outreachJobIds } from "@/network/crm";
import { generateDraft } from "@/network/draft";

// The referral half of the apply pipeline (spec §1.4, §4). A job the user (or Claude) tagged
// as "worth a referral" leaves the queue through takeNextReferral → status 'referral_seeking';
// the attended session finds a person and creates an outreach (createReferralOutreach); the user
// approves it on /apply (existing gate.ts red line); once actually sent, markReached stamps the
// jobs; the user then resolves each company card with referralDecide. The direct picker in
// queue.ts never sees referral_seeking/referral_ready rows, so the two modes can't collide.

export const MAX_SIBLINGS = 2; // 1 primary + 2 siblings = 3 jobs per outreach
// How many people the attended session contacts per company, in parallel (one person is a coin
// flip; three cover the usual no-reply/decline cases).
export const MAX_PEOPLE_PER_COMPANY = 3;
export const OVERDUE_DAYS = 7;

export interface ReferralTaskJob {
  jobId: number;
  title: string;
  applyUrl: string | null;
  direction: string | null;
  score: number | null;
}
export interface ReferralKnownPerson {
  id: number;
  name: string;
  relation: string | null;
  roleTitle: string | null;
  linkedinUrl: string | null;
  email: string | null;
  contacted: boolean;
}
export interface ReferralTask {
  company: string;
  jobs: ReferralTaskJob[];
  knownPeople: ReferralKnownPerson[];
  skipPersonIds: number[];
}

interface JobRow {
  job_id: number;
  company: string;
  title: string;
  apply_url: string | null;
  direction: string | null;
  score: number | null;
}

const ELIGIBLE = `a.needs_manual_reason IS NULL AND j.loc_flag IS NULL`;
const ORDER = `ORDER BY a.pinned DESC, COALESCE(m.tier, 9) ASC, m.score DESC, j.created_at DESC`;
const SELECT = `SELECT j.id as job_id, j.company, j.title, j.apply_url, m.direction, m.score
       FROM applications a JOIN jobs j ON j.id = a.job_id JOIN matches m ON m.job_id = j.id`;

// Session -> App: the next company to seek a referral at. Batch mode picks the best queued job
// whose effective mode is 'referral' (optionally within one direction); targeted mode (jobIds,
// from the board's 换人再问) only considers the given ids. Up to MAX_SIBLINGS more queued
// referral-mode jobs at the same company ride along so one message can cover them all.
export function takeNextReferral(db: DB, opts: { direction?: string; jobIds?: number[] } = {}): ReferralTask | { done: true } {
  const targeted = !!opts.jobIds?.length;
  const idList = targeted ? opts.jobIds!.map(() => "?").join(",") : "";
  for (;;) {
    const primary = (
      targeted
        ? db
            .prepare(`${SELECT} WHERE a.status = 'matched' AND ${ELIGIBLE} AND a.job_id IN (${idList}) ${ORDER} LIMIT 1`)
            .get(...opts.jobIds!)
        : db
            .prepare(
              `${SELECT} WHERE a.status = 'matched' AND ${ELIGIBLE} AND ${EFFECTIVE_MODE_SQL} = 'referral'
               ${opts.direction ? "AND m.direction = ?" : ""} ${ORDER} LIMIT 1`
            )
            .get(...(opts.direction ? [opts.direction] : []))
    ) as JobRow | undefined;
    if (!primary) return { done: true };

    const siblings = db
      .prepare(
        `${SELECT} WHERE a.status = 'matched' AND ${ELIGIBLE} AND j.id <> ? AND j.company = ? COLLATE NOCASE
         ${targeted ? `AND a.job_id IN (${idList})` : `AND ${EFFECTIVE_MODE_SQL} = 'referral'`}
         ${ORDER} LIMIT ${MAX_SIBLINGS}`
      )
      .all(primary.job_id, primary.company, ...(targeted ? opts.jobIds! : [])) as JobRow[];

    const jobs = [primary, ...siblings];
    const claim = db.prepare(
      "UPDATE applications SET status = 'referral_seeking', confirm_decision = NULL WHERE job_id = ? AND status = 'matched'"
    );
    const claimed = db.transaction(() => jobs.filter((r) => claim.run(r.job_id).changes === 1))();
    if (claimed.length === 0) continue; // lost a race on every row — pick again

    const people = db
      .prepare(
        `SELECT p.id, p.name, p.relation, p.role_title, p.linkedin_url, p.email,
                EXISTS (SELECT 1 FROM outreach o WHERE o.person_id = p.id AND o.playbook = 'referral'
                        AND o.status NOT IN ('draft','archived')) AS contacted
         FROM people p WHERE p.company = ? COLLATE NOCASE ORDER BY (p.relation = 'alum') DESC, p.id ASC`
      )
      .all(primary.company) as {
      id: number;
      name: string;
      relation: string | null;
      role_title: string | null;
      linkedin_url: string | null;
      email: string | null;
      contacted: number;
    }[];

    return {
      company: primary.company,
      jobs: claimed.map((r) => ({ jobId: r.job_id, title: r.title, applyUrl: r.apply_url, direction: r.direction, score: r.score })),
      knownPeople: people.map((p) => ({
        id: p.id,
        name: p.name,
        relation: p.relation,
        roleTitle: p.role_title,
        linkedinUrl: p.linkedin_url,
        email: p.email,
        contacted: p.contacted === 1,
      })),
      skipPersonIds: people.filter((p) => p.contacted === 1).map((p) => p.id),
    };
  }
}

// Session -> App: nobody reachable at this company. Stays referral_seeking (the user decides:
// 直接投 / fill a WeChat referral / retry later); the reason surfaces on the board card.
export function reportNoContact(db: DB, jobIds: number[], reason: string): void {
  const stmt = db.prepare("UPDATE applications SET needs_manual_reason = ? WHERE job_id = ? AND status = 'referral_seeking'");
  db.transaction(() => {
    for (const id of jobIds) stmt.run(`no contact found: ${reason}`, id);
  })();
}

// Called right after gate.reportSent for an outreach that covers jobs: stamps when the request
// actually went out (the "已等 N 天" clock) and which outreach it was. No-op for coffee-chat
// outreach with no linked jobs.
export function markReached(db: DB, outreachId: number): void {
  const ids = outreachJobIds(db, outreachId);
  const stmt = db.prepare(
    "UPDATE applications SET referral_reached_at = datetime('now'), origin_outreach_id = ?, needs_manual_reason = NULL WHERE job_id = ? AND status = 'referral_seeking'"
  );
  db.transaction(() => {
    for (const id of ids) stmt.run(outreachId, id);
  })();
}

export async function createReferralOutreach(
  db: DB,
  opts: { backend: LlmBackend; profile: Profile; jobIds: number[]; person: PersonInput; channel?: Channel }
): Promise<{ outreachId: number; draft: string }> {
  if (opts.jobIds.length === 0 || opts.jobIds.length > MAX_SIBLINGS + 1) {
    throw new Error(`createReferralOutreach: jobIds must have 1..${MAX_SIBLINGS + 1} entries`);
  }
  const personId = upsertPerson(db, opts.person);
  const res = await generateDraft(db, {
    backend: opts.backend,
    profile: opts.profile,
    personId,
    playbook: "referral",
    jobIds: opts.jobIds,
    channel: opts.channel ?? "linkedin",
  });
  logEvent(db, "referral_outreach_created", { entity: "outreach", entityId: res.outreachId, payload: { jobIds: opts.jobIds, personId } });
  return res;
}

export interface ReferralInfo {
  source: "linkedin" | "email" | "wechat" | "other";
  link?: string;
  code?: string;
  note?: string;
  at: string;
}
export interface ReferralCardJob extends ReferralTaskJob {
  status: "referral_seeking" | "referral_ready";
  noContactReason: string | null;
  referralInfo: ReferralInfo | null;
  referralPersonName: string | null;
}
export interface ReferralCardOutreach {
  id: number;
  personId: number;
  personName: string;
  relation: string | null;
  linkedinUrl: string | null;
  channel: string;
  status: string;
  draft: string | null;
  draftNote: string | null;
  sentAt: string | null;
  // Referral-conversation monitor (src/network/harvest.ts)
  stage: string | null;
  stageSummary: string | null;
  stageAction: string | null;
  stageLink: string | null;
  lastCheckedAt: string | null;
  lastMessage: { dir: "sent" | "received"; at: string; text: string } | null;
}
export interface ReferralCard {
  company: string;
  jobs: ReferralCardJob[];
  // Every person contacted (or drafted) for this company, newest first — several in parallel.
  outreaches: ReferralCardOutreach[];
  daysWaiting: number | null;
  overdue: boolean;
}

// /apply's 内推进行中 board: one card per company, its in-flight jobs, and the latest outreach.
export function referralBoard(db: DB, now: () => number = () => Date.now()): ReferralCard[] {
  const rows = db
    .prepare(
      `SELECT j.id as job_id, j.company, j.title, j.apply_url, m.direction, m.score, a.status, a.needs_manual_reason,
              a.referral_info, a.referral_reached_at, p.name as referral_person_name
       FROM applications a JOIN jobs j ON j.id = a.job_id LEFT JOIN matches m ON m.job_id = j.id
       LEFT JOIN people p ON p.id = a.referral_person_id
       WHERE a.status IN ('referral_seeking','referral_ready')
       ORDER BY j.company COLLATE NOCASE, m.score DESC`
    )
    .all() as (JobRow & {
    status: "referral_seeking" | "referral_ready";
    needs_manual_reason: string | null;
    referral_info: string | null;
    referral_reached_at: string | null;
    referral_person_name: string | null;
  })[];

  const byCompany = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.company.toLowerCase();
    byCompany.set(key, [...(byCompany.get(key) ?? []), r]);
  }
  const cards: ReferralCard[] = [];
  for (const group of byCompany.values()) {
    // Every outreach across the group's jobs (several people per company), archived ones hidden.
    const outreaches: ReferralCardOutreach[] = outreachesForJobs(db, group.map((r) => r.job_id))
      .filter((o) => o.status !== "archived")
      .map((o) => {
        const person = db.prepare("SELECT relation, linkedin_url FROM people WHERE id = ?").get(o.personId) as {
          relation: string | null;
          linkedin_url: string | null;
        };
        const sent = o.threadLog.find((t) => t.dir === "sent");
        return {
          id: o.id,
          personId: o.personId,
          personName: o.personName,
          relation: person.relation,
          linkedinUrl: person.linkedin_url,
          channel: o.channel,
          status: o.status,
          draft: o.draft,
          draftNote: o.draftNote,
          sentAt: sent?.at ?? null,
          stage: o.referralStage,
          stageSummary: o.stageSummary,
          stageAction: o.stageAction,
          stageLink: o.stageLink,
          lastCheckedAt: o.lastCheckedAt,
          lastMessage: o.threadLog.length ? o.threadLog[o.threadLog.length - 1] : null,
        };
      });
    const reached = group.map((r) => r.referral_reached_at).filter((x): x is string => !!x).sort()[0] ?? null;
    const daysWaiting = reached ? Math.floor((now() - Date.parse(reached.replace(" ", "T") + "Z")) / 86400_000) : null;
    cards.push({
      company: group[0].company,
      jobs: group.map((r) => ({
        jobId: r.job_id,
        title: r.title,
        applyUrl: r.apply_url,
        direction: r.direction,
        score: r.score,
        status: r.status,
        noContactReason: r.needs_manual_reason,
        referralInfo: safeJson(r.referral_info),
        referralPersonName: r.referral_person_name,
      })),
      outreaches,
      daysWaiting,
      overdue: daysWaiting != null && daysWaiting > OVERDUE_DAYS,
    });
  }
  return cards;
}

function safeJson(s: string | null): ReferralInfo | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as ReferralInfo;
  } catch {
    return null;
  }
}

export type ReferralAction = "direct" | "won" | "retry" | "archive";
export interface ReferralDecideInput {
  jobIds: number[];
  action: ReferralAction;
  info?: Omit<ReferralInfo, "at">;
  personName?: string;
}
export interface ReferralDecideResult {
  jobIds: number[];
  startMode: "direct" | "referral" | null;
}

// User -> App from the board card buttons. Every action is a transaction over all jobIds; the
// caller (API route) is responsible for enqueueing the run described by startMode.
export function referralDecide(db: DB, input: ReferralDecideInput): ReferralDecideResult {
  if (!input.jobIds?.length) throw new Error("referralDecide: jobIds is empty");
  const rows = input.jobIds.map((id) => {
    const r = db
      .prepare("SELECT a.status, j.company FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.job_id = ?")
      .get(id) as { status: string; company: string } | undefined;
    if (!r) throw new Error(`referralDecide: no application for job ${id}`);
    if (r.status !== "referral_seeking" && r.status !== "referral_ready") {
      throw new Error(`referralDecide: job ${id} is '${r.status}' (must be referral_seeking or referral_ready)`);
    }
    return { id, ...r };
  });
  const outreachIds = new Set<number>(outreachesForJobs(db, rows.map((r) => r.id)).map((o) => o.id));
  const setOutreach = (from: string[], to: string) => {
    const stmt = db.prepare(`UPDATE outreach SET status = ? WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`);
    for (const oid of outreachIds) stmt.run(to, oid, ...from);
  };

  const tx = db.transaction((): ReferralDecideResult => {
    switch (input.action) {
      case "direct":
        for (const r of rows) {
          db.prepare("UPDATE applications SET status = 'matched', apply_mode = 'direct', needs_manual_reason = NULL WHERE job_id = ?").run(r.id);
        }
        setOutreach(["draft", "pending_send"], "archived");
        break;
      case "won": {
        if (!input.info) throw new Error("referralDecide: action 'won' requires info");
        let personId: number | null = null;
        if (input.personName?.trim()) {
          personId = upsertPerson(db, { name: input.personName.trim(), company: rows[0].company, relation: "other", source: "referral_won" });
        } else {
          for (const oid of outreachIds) {
            personId = (db.prepare("SELECT person_id FROM outreach WHERE id = ?").get(oid) as { person_id: number }).person_id;
          }
        }
        const info: ReferralInfo = { ...input.info, at: new Date().toISOString() };
        for (const r of rows) {
          db.prepare(
            "UPDATE applications SET status = 'referral_ready', referral_info = ?, referral_person_id = COALESCE(?, referral_person_id), needs_manual_reason = NULL WHERE job_id = ?"
          ).run(JSON.stringify(info), personId, r.id);
        }
        setOutreach(["sent", "replied", "pending_send", "draft"], "referral_won");
        break;
      }
      case "retry":
        for (const r of rows) {
          db.prepare("UPDATE applications SET status = 'matched', apply_mode = 'referral', pinned = 1, needs_manual_reason = NULL WHERE job_id = ?").run(r.id);
        }
        setOutreach(["sent", "replied"], "no_response");
        setOutreach(["draft", "pending_send"], "archived");
        break;
      case "archive":
        for (const r of rows) {
          db.prepare("UPDATE applications SET status = 'archived', needs_manual_reason = 'user gave up referral' WHERE job_id = ?").run(r.id);
        }
        setOutreach(["draft", "pending_send"], "archived");
        break;
      default:
        throw new Error(`referralDecide: invalid action '${String(input.action)}'`);
    }
    logEvent(db, "referral_decide", { entity: "application", payload: { jobIds: input.jobIds, action: input.action } });
    return {
      jobIds: input.jobIds,
      startMode: input.action === "direct" || input.action === "won" ? "direct" : input.action === "retry" ? "referral" : null,
    };
  });
  return tx();
}
