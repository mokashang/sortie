import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { parseProfile } from "@/lib/profile";
import { upsertPerson, createOutreach } from "@/network/crm";
import { approveOutreach, reportSent } from "@/network/gate";
import { harvestOutreach, referralChecklist } from "@/network/harvest";
import { followUpAfterHarvest, approveFollowup, reportFollowupSent, rejectFollowup, unapproveFollowup, activeFollowup, planFollowup } from "@/network/followup";
import { checkLinks } from "@/network/links";
import { contactVerdict, decideCompany, ContactFacts, INVITE_OUT_DAYS, MAX_WAIT_DAYS } from "@/apply/referral-policy";
import { resolveReferrals, afterReferralSubmitted } from "@/apply/referral-auto";
import { referralBoard } from "@/apply/referral";
import { parseReferral } from "@/apply/queue";
import { setAutoSubmit } from "@/apply/auto-submit";
import { LlmBackend, LlmRequest } from "@/llm/types";

// The App settles a company's referral hunt on its own (user, 2026-10-15): a yes → apply with the
// referral; everyone out → apply directly; the referrer hears once the application is in.

const U = "legacy";
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const profile = parseProfile(`
name: Mengjia Shang
email: mengjia@example.com
phone: "1"
linkedin: linkedin.com/in/x
github: github.com/x
school: USC
degree: M.S. ECE
grad_date: "2027-05"
work_auth: { status: F-1, needs_sponsorship: true }
targets: { primary: newgrad }
directions: { swe_general: 1 }
`);

const JOB_URL = "https://job-boards.greenhouse.io/drweng/jobs/7980165";

function seedJob(db: DB, company = "Google"): number {
  const id = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, company, "SWE New Grad", JOB_URL, "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(id, "swe_general", 90, 1);
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'referral_seeking')").run(id);
  return id;
}

// One person contacted with a connection note for the given jobs; `sentDaysAgo` backdates it.
function contact(db: DB, jobIds: number[], opts: { name: string; sentDaysAgo?: number; company?: string }): number {
  const pid = upsertPerson(db, U, { name: opts.name, company: opts.company ?? "Google", relation: "alum", linkedin_url: `https://li/${opts.name}` });
  const oid = createOutreach(db, U, { personId: pid, playbook: "referral", channel: "linkedin", draft: "full", draftNote: "note", jobIds });
  approveOutreach(db, U, oid);
  reportSent(db, U, oid, "note");
  if (opts.sentDaysAgo != null) {
    const at = new Date(Date.now() - opts.sentDaysAgo * DAY).toISOString();
    db.prepare("UPDATE outreach SET thread_log = json_set(thread_log, '$[0].at', ?) WHERE id = ?").run(at, oid);
    db.prepare("UPDATE applications SET referral_reached_at = datetime('now', ?) WHERE job_id IN (" + jobIds.join(",") + ")").run(`-${opts.sentDaysAgo} days`);
  }
  return oid;
}

function backend(opts: { stage?: object; followup?: object | (() => object) } = {}): LlmBackend & { followupCalls: LlmRequest[] } {
  const b = {
    name: "fake",
    followupCalls: [] as LlmRequest[],
    complete: async (req: LlmRequest) => {
      if ((req.system ?? "").includes("continuing a LinkedIn conversation")) {
        b.followupCalls.push(req);
        const f = typeof opts.followup === "function" ? opts.followup() : opts.followup;
        return { text: JSON.stringify(f ?? { message: "Thank you!", reason: "道谢" }), backend: "fake" };
      }
      return { text: JSON.stringify(opts.stage ?? { stage: "replied", summary: "对方回复了", action: null, link: null }), backend: "fake" };
    },
  };
  return b;
}

function recorder() {
  const started: number[][] = [];
  const pushed: string[] = [];
  return {
    started,
    pushed,
    deps: {
      startApply: (_db: DB, _u: string, jobIds: number[]) => {
        started.push(jobIds);
        return { autoStarted: true, runId: 77 };
      },
      notify: (title: string) => {
        pushed.push(title);
      },
    },
  };
}

const status = (db: DB, jobId: number) =>
  db.prepare("SELECT status, apply_mode, referral_info, referral_person_id FROM applications WHERE job_id = ?").get(jobId) as {
    status: string;
    apply_mode: string | null;
    referral_info: string | null;
    referral_person_id: number | null;
  };

describe("checkLinks", () => {
  it("repairs a retyped link a letter off, keeps exact ones, reports strangers", () => {
    const allowed = [JOB_URL, "linkedin.com/in/x", null];
    const r = checkLinks("Roles: https://job-boards.greenhouge.io/drweng/jobs/7980165. Me: https://www.linkedin.com/in/x/", allowed);
    expect(r.fixed).toEqual([{ from: "https://job-boards.greenhouge.io/drweng/jobs/7980165", to: JOB_URL }]);
    expect(r.text).toBe(`Roles: ${JOB_URL}. Me: https://www.linkedin.com/in/x/`);
    expect(r.unknown).toEqual([]);
    expect(checkLinks("see https://evil.example.com/a", allowed).unknown).toEqual(["https://evil.example.com/a"]);
  });
});

describe("decideCompany", () => {
  const c = (over: Partial<ContactFacts>): ContactFacts => ({ outreachId: 1, status: "sent", stage: "pending", firstSentAt: ago(1), exhausted: false, ...over });
  const facts = (contacts: ContactFacts[], over: object = {}) => ({ contacts, reachedAt: ago(1), noContact: false, claimLive: false, now: NOW, ...over });

  it("verdicts per contact", () => {
    expect(contactVerdict(c({ stage: "will_refer", status: "replied" }), NOW)).toBe("won");
    expect(contactVerdict(c({ stage: "no_headcount", status: "replied" }), NOW)).toBe("out");
    expect(contactVerdict(c({ firstSentAt: ago(INVITE_OUT_DAYS) }), NOW)).toBe("out");
    expect(contactVerdict(c({ firstSentAt: ago(INVITE_OUT_DAYS - 1) }), NOW)).toBe("alive");
    expect(contactVerdict(c({ status: "accepted", stage: "accepted", exhausted: true }), NOW)).toBe("out");
    expect(contactVerdict(c({ status: "accepted", stage: "accepted" }), NOW)).toBe("alive");
    expect(contactVerdict(c({ status: "draft", firstSentAt: null }), NOW)).toBe("unsent");
  });

  it("a yes wins at once — 'referred' over 'will_refer' — even with others still out or waiting", () => {
    const d = decideCompany(
      facts([c({ outreachId: 1, status: "replied", stage: "will_refer" }), c({ outreachId: 2, status: "replied", stage: "referred" }), c({ outreachId: 3 })])
    );
    expect(d).toEqual({ action: "won", outreachId: 2 });
  });

  it("everyone out → direct; one still waiting → wait, with the date it goes direct", () => {
    expect(decideCompany(facts([c({ stage: "declined", status: "replied" }), c({ firstSentAt: ago(20) })]))).toEqual({ action: "direct", why: "all_out" });
    const d = decideCompany(facts([c({ stage: "declined", status: "replied" }), c({ firstSentAt: ago(10) })]));
    expect(d).toEqual({ action: "wait", directAt: new Date(NOW + 4 * DAY).toISOString() });
  });

  it("a live conversation waits up to the 30-day cap", () => {
    const live = [c({ status: "replied", stage: "replied" })];
    expect(decideCompany(facts(live, { reachedAt: ago(MAX_WAIT_DAYS) }))).toEqual({ action: "direct", why: "timeout" });
    expect(decideCompany(facts(live, { reachedAt: ago(10) }))).toEqual({ action: "wait", directAt: new Date(NOW + 20 * DAY).toISOString() });
  });

  it("nobody found → direct; still searching or drafts waiting for approval → wait", () => {
    expect(decideCompany(facts([], { noContact: true, reachedAt: null }))).toEqual({ action: "direct", why: "no_contact" });
    expect(decideCompany(facts([], { claimLive: false, reachedAt: null }))).toEqual({ action: "direct", why: "no_contact" });
    expect(decideCompany(facts([], { claimLive: true, reachedAt: null })).action).toBe("wait");
    expect(decideCompany(facts([c({ status: "draft", firstSentAt: null })], { reachedAt: null })).action).toBe("wait");
  });
});

describe("resolveReferrals", () => {
  it("someone says yes with an email → 有内推了 with that person and email, applications queued", async () => {
    const db = openDb(":memory:");
    const jobs = [seedJob(db), seedJob(db)];
    const ann = contact(db, jobs, { name: "Ann" });
    const jane = contact(db, jobs, { name: "Jane" });
    const b = backend({ stage: { stage: "will_refer", summary: "答应内推", action: "投的时候填我的邮箱", link: "jane@google.com" } });
    await harvestOutreach(db, { userId: U, backend: b, outreachId: jane, accepted: true, messages: [{ dir: "received", text: "Happy to refer! Put jane@google.com as referrer." }] });
    const rec = recorder();
    const out = resolveReferrals(db, U, rec.deps);

    expect(out).toEqual([{ company: "Google", jobIds: jobs, action: "won", personName: "Jane", runId: 77 }]);
    expect(rec.started).toEqual([jobs]);
    expect(rec.pushed[0]).toContain("Google");
    const janeId = (db.prepare("SELECT person_id FROM outreach WHERE id = ?").get(jane) as { person_id: number }).person_id;
    for (const j of jobs) {
      const s = status(db, j);
      expect(s.status).toBe("referral_ready");
      expect(s.referral_person_id).toBe(janeId);
      const pack = parseReferral(s.referral_info, "Jane")!;
      expect(pack).toMatchObject({ person_name: "Jane", email: "jane@google.com", link: "", code: "" });
      expect(pack.note).toContain("Referred by Jane");
    }
    expect((db.prepare("SELECT status FROM outreach WHERE id = ?").get(ann) as { status: string }).status).toBe("referral_won");
    // Settled: a second pass does nothing.
    expect(resolveReferrals(db, U, rec.deps)).toEqual([]);
  });

  it("a referral URL is opened instead of the job page; a short token is a code", async () => {
    const db = openDb(":memory:");
    const j1 = seedJob(db, "Acme");
    const o1 = contact(db, [j1], { name: "Al", company: "Acme" });
    await harvestOutreach(db, { userId: U, backend: backend({ stage: { stage: "referred", summary: "s", link: "https://acme.com/r/abc" } }), outreachId: o1, accepted: true, messages: [{ dir: "received", text: "done" }] });
    const j2 = seedJob(db, "Beta");
    const o2 = contact(db, [j2], { name: "Bo", company: "Beta" });
    await harvestOutreach(db, { userId: U, backend: backend({ stage: { stage: "referred", summary: "s", link: "REF-42" } }), outreachId: o2, accepted: true, messages: [{ dir: "received", text: "code REF-42" }] });
    resolveReferrals(db, U, recorder().deps);
    expect(parseReferral(status(db, j1).referral_info, "Al")).toMatchObject({ link: "https://acme.com/r/abc", code: "" });
    expect(parseReferral(status(db, j2).referral_info, "Bo")).toMatchObject({ link: "", code: "REF-42" });
  });

  it("every invite unaccepted after 14 days → apply directly; younger invites wait, and the card says when", () => {
    const db = openDb(":memory:");
    const old = seedJob(db, "Old");
    contact(db, [old], { name: "A", company: "Old", sentDaysAgo: 15 });
    contact(db, [old], { name: "B", company: "Old", sentDaysAgo: 15 });
    const fresh = seedJob(db, "Fresh");
    contact(db, [fresh], { name: "C", company: "Fresh", sentDaysAgo: 3 });
    const rec = recorder();
    const out = resolveReferrals(db, U, rec.deps);
    expect(out).toEqual([{ company: "Old", jobIds: [old], action: "direct", why: "all_out", runId: 77 }]);
    expect(status(db, old)).toMatchObject({ status: "matched", apply_mode: "direct" });
    expect(status(db, fresh).status).toBe("referral_seeking");
    const card = referralBoard(db, U).find((x) => x.company === "Fresh")!;
    const inDays = (Date.parse(card.autoDirectAt!) - Date.now()) / DAY;
    expect(inDays).toBeGreaterThan(10.9);
    expect(inDays).toBeLessThan(11.1);
  });
});

describe("telling the referrer it's in", () => {
  it("after the referral application is submitted, one 'applied' message to the referrer only", async () => {
    const db = openDb(":memory:");
    const job = seedJob(db);
    const ann = contact(db, [job], { name: "Ann" });
    const jane = contact(db, [job], { name: "Jane" });
    const b = backend({
      stage: { stage: "will_refer", summary: "答应内推", link: null },
      followup: { message: "Just submitted SWE New Grad and listed you as my referrer. Thank you, Jane!", reason: "告诉对方已投递" },
    });
    await harvestOutreach(db, { userId: U, backend: b, outreachId: jane, accepted: true, messages: [{ dir: "received", text: "Sure, I'll refer you." }] });
    const reply = await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: jane });
    rejectFollowup(db, U, reply.followup!.id);
    resolveReferrals(db, U, recorder().deps);

    // Nothing to announce before the application goes in; the won thread drops off after two quiet weeks.
    expect((await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: jane })).drafted).toBe(false);
    expect(referralChecklist(db, U, () => Date.now() + 30 * DAY).map((x) => x.outreachId)).not.toContain(jane);

    db.prepare("UPDATE applications SET status = 'submitted', submitted_at = datetime('now') WHERE job_id = ?").run(job);
    expect(referralChecklist(db, U, () => Date.now() + 30 * DAY).map((x) => x.outreachId)).toContain(jane);
    const r = await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: jane });
    expect(r.followup).toMatchObject({ kind: "applied", status: "draft" });
    expect(b.followupCalls.at(-1)!.prompt).toContain("Applications submitted:\n- Google: SWE New Grad");
    // Ann never accepted: her thread is referral_won too, but she is not the referrer.
    expect((await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: ann })).drafted).toBe(false);

    approveFollowup(db, U, r.followup!.id);
    reportFollowupSent(db, U, r.followup!.id);
    expect((await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: jane })).drafted).toBe(false);
  });

  it("the plan waits while another message for the same point is still on its way", () => {
    const thread = [
      { at: "2026-10-01T10:00:00.000Z", dir: "sent" as const, text: "note" },
      { at: "2026-10-02T10:00:00.000Z", dir: "received" as const, text: "sure" },
    ];
    const base = { status: "referral_won", stage: "will_refer", thread, fullDraft: null, seeking: false, announce: true, now: NOW };
    expect(planFollowup({ ...base, history: [] })).toEqual({ action: "draft", kind: "applied", answersAt: thread[1].at });
    expect(planFollowup({ ...base, history: [{ kind: "reply", answersAt: thread[1].at, status: "pending_send", sentAt: null }] })).toEqual({ action: "none", reason: "handled" });
    expect(planFollowup({ ...base, history: [{ kind: "applied", answersAt: thread[1].at, status: "sent", sentAt: "x" }] })).toEqual({ action: "none", reason: "handled" });
  });

  it("a submitted referral application queues a conversation check; a plain one doesn't", async () => {
    const db = openDb(":memory:");
    const job = seedJob(db);
    const jane = contact(db, [job], { name: "Jane" });
    await harvestOutreach(db, { userId: U, backend: backend({ stage: { stage: "will_refer", summary: "s", link: null } }), outreachId: jane, accepted: true, messages: [{ dir: "received", text: "yes" }] });
    resolveReferrals(db, U, recorder().deps);
    db.prepare("UPDATE applications SET status = 'submitted', submitted_at = datetime('now') WHERE job_id = ?").run(job);
    const calls: string[] = [];
    const startExecutor = ((_db: DB, _u: string, kind: string) => {
      calls.push(kind);
      return { id: 5 };
    }) as never;
    expect(afterReferralSubmitted(db, U, job, { startExecutor })).toBe(5);
    expect(calls).toEqual(["referral_check"]);
    const plain = db.prepare("INSERT INTO jobs (fingerprint, company, title, source) VALUES ('p','X','Y','manual')").run().lastInsertRowid as number;
    db.prepare("INSERT INTO applications (job_id, status, submitted_at) VALUES (?, 'submitted', datetime('now'))").run(plain);
    expect(afterReferralSubmitted(db, U, plain, { startExecutor })).toBeNull();
  });
});

describe("links in drafted follow-ups", () => {
  it("a retyped job link is repaired before it is stored", async () => {
    const db = openDb(":memory:");
    const o = contact(db, [seedJob(db)], { name: "Kayla" });
    const b = backend({ followup: { message: "Thanks for connecting! The role: https://job-boards.greenhouge.io/drweng/jobs/7980165", reason: "r" } });
    await harvestOutreach(db, { userId: U, backend: b, outreachId: o, accepted: true });
    const r = await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: o });
    expect(r.followup!.text).toBe(`Thanks for connecting! The role: ${JOB_URL}`);
  });

  it("a made-up link gets one redraft; a second miss stores nothing", async () => {
    const db = openDb(":memory:");
    const o = contact(db, [seedJob(db)], { name: "Kim" });
    let n = 0;
    const b = backend({ followup: () => (n++ === 0 ? { message: "See https://made.up/page", reason: "r" } : { message: `Here: ${JOB_URL}`, reason: "r" }) });
    await harvestOutreach(db, { userId: U, backend: b, outreachId: o, accepted: true });
    const r = await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: o });
    expect(r.followup!.text).toBe(`Here: ${JOB_URL}`);
    expect(b.followupCalls[1].prompt).toContain("https://made.up/page");

    const db2 = openDb(":memory:");
    const o2 = contact(db2, [seedJob(db2)], { name: "Kim" });
    const bad = backend({ followup: { message: "See https://made.up/page", reason: "r" } });
    await harvestOutreach(db2, { userId: U, backend: bad, outreachId: o2, accepted: true });
    const r2 = await followUpAfterHarvest(db2, { userId: U, backend: bad, profile, outreachId: o2 });
    expect(r2.error).toContain("made.up");
    expect(activeFollowup(db2, U, o2)).toBeNull();
  });

  it("with 自动投递 on, a draft sent back over a mistyped link is fixed and approved again", async () => {
    const db = openDb(":memory:");
    setAutoSubmit(db, U, true);
    const o = contact(db, [seedJob(db)], { name: "Kayla" });
    const b = backend({ followup: { message: `The role: ${JOB_URL}`, reason: "r" } });
    await harvestOutreach(db, { userId: U, backend: b, outreachId: o, accepted: true });
    const r = await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: o });
    expect(r.followup!.status).toBe("pending_send");
    // The session caught a typo (an older draft) and sent it back.
    unapproveFollowup(db, U, r.followup!.id);
    db.prepare("UPDATE outreach_followups SET draft = ? WHERE id = ?").run("The role: https://job-boards.greenhouge.io/drweng/jobs/7980165", r.followup!.id);
    const again = await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: o });
    expect(again.followup).toMatchObject({ id: r.followup!.id, status: "pending_send", text: `The role: ${JOB_URL}` });
    // A draft sent back for any other reason stays with the user.
    unapproveFollowup(db, U, r.followup!.id);
    expect((await followUpAfterHarvest(db, { userId: U, backend: b, profile, outreachId: o })).followup!.status).toBe("draft");
  });
});
