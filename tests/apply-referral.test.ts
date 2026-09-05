import { describe, it, expect } from "vitest";
import { openDb, DB } from "@/lib/db";
import { parseProfile } from "@/lib/profile";
import { upsertPerson, createOutreach, outreachJobIds } from "@/network/crm";
import { approveOutreach, reportSent } from "@/network/gate";
import {
  takeNextReferral,
  reportNoContact,
  markReached,
  referralBoard,
  referralDecide,
  createReferralOutreach,
  ReferralTask,
} from "@/apply/referral";
import { LlmBackend } from "@/llm/types";

const yaml = `
name: Mengjia Shang
email: mengjia@example.com
phone: "1"
linkedin: linkedin.com/in/x
github: github.com/x
school: USC
degree: M.S. ECE
grad_date: "2027-05"
work_auth: { status: F-1, needs_sponsorship: true }
targets: { primary: newgrad, secondary: intern }
directions: { swe_general: 1 }
daily_minutes_budget: 90
`;

function seed(
  db: DB,
  o: { company?: string; title?: string; score?: number; fit?: number | null; status?: string; direction?: string } = {}
): number {
  const id = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, o.company ?? "Google", o.title ?? "SWE", "https://g/apply", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier, referral_fit) VALUES (?,?,?,?,?)").run(
    id,
    o.direction ?? "swe_general",
    o.score ?? 90,
    1,
    o.fit === undefined ? 1 : o.fit
  );
  db.prepare("INSERT INTO applications (job_id, status) VALUES (?,?)").run(id, o.status ?? "matched");
  return id;
}
const status = (db: DB, id: number) =>
  db
    .prepare(
      "SELECT status, apply_mode, pinned, needs_manual_reason, referral_info, referral_person_id, referral_reached_at, origin_outreach_id FROM applications WHERE job_id = ?"
    )
    .get(id) as Record<string, unknown>;

describe("takeNextReferral", () => {
  it("takes the best referral-mode job plus up to 2 same-company siblings, all → referral_seeking", () => {
    const db = openDb(":memory:");
    const a = seed(db, { score: 95, title: "SWE" });
    const b = seed(db, { score: 90, title: "SRE" });
    const c = seed(db, { score: 85, title: "MLE" });
    const d = seed(db, { score: 80, title: "Data" });
    const other = seed(db, { company: "Meta", score: 99, fit: 0 });
    const t = takeNextReferral(db, {}) as ReferralTask;
    expect(t.company).toBe("Google");
    expect(t.jobs.map((j) => j.jobId)).toEqual([a, b, c]);
    for (const id of [a, b, c]) expect(status(db, id).status).toBe("referral_seeking");
    expect(status(db, d).status).toBe("matched");
    expect(status(db, other).status).toBe("matched");
    const next = takeNextReferral(db, {}) as ReferralTask;
    expect(next.jobs.map((j) => j.jobId)).toEqual([d]);
    expect(takeNextReferral(db, {})).toEqual({ done: true });
  });

  it("direction scoping and jobIds targeting; knownPeople lists CRM contacts at the company with contacted flag", () => {
    const db = openDb(":memory:");
    const a = seed(db, { direction: "ai_infra" });
    // Siblings are same-company jobs in ANY direction (one message covers all roles there).
    const b = seed(db, { direction: "swe_general", score: 70 });
    seed(db, { company: "Meta", direction: "swe_general", score: 99 }); // other company, must not ride along
    const pid = upsertPerson(db, { name: "Jane", company: "Google", relation: "alum", linkedin_url: "https://li/jane" });
    createOutreach(db, { personId: pid, playbook: "referral", channel: "linkedin", draft: "x", jobIds: [a] });
    upsertPerson(db, { name: "Bob", company: "google", relation: "engineer" });
    const t = takeNextReferral(db, { direction: "ai_infra" }) as ReferralTask;
    expect(t.jobs.map((j) => j.jobId)).toEqual([a, b]);
    expect(t.knownPeople.map((p) => [p.name, p.contacted])).toEqual([
      ["Jane", true],
      ["Bob", false],
    ]);
    expect(t.skipPersonIds).toEqual([pid]);
    const targeted = seed(db, { company: "Meta", fit: 0 });
    expect((takeNextReferral(db, { jobIds: [targeted] }) as ReferralTask).jobs[0].jobId).toBe(targeted);
    expect(takeNextReferral(db, { jobIds: [targeted] })).toEqual({ done: true });
  });
});

describe("outreach → reached → board", () => {
  it("markReached stamps referral_reached_at + origin_outreach_id; board shows days waiting and overdue > 7d", () => {
    const db = openDb(":memory:");
    const a = seed(db);
    takeNextReferral(db, {});
    const pid = upsertPerson(db, { name: "Jane", company: "Google", relation: "alum" });
    const oid = createOutreach(db, { personId: pid, playbook: "referral", channel: "linkedin", draft: "hi", jobIds: [a] });
    approveOutreach(db, oid);
    reportSent(db, oid);
    markReached(db, oid);
    expect(status(db, a).referral_reached_at).toBeTruthy();
    expect(status(db, a).origin_outreach_id).toBe(oid);
    const eightDays = () => Date.now() + 8 * 86400_000;
    const cards = referralBoard(db, eightDays);
    expect(cards).toHaveLength(1);
    expect(cards[0].company).toBe("Google");
    expect(cards[0].outreach?.status).toBe("sent");
    expect(cards[0].outreach?.personName).toBe("Jane");
    expect(cards[0].daysWaiting).toBe(8);
    expect(cards[0].overdue).toBe(true);
    expect(referralBoard(db)[0].overdue).toBe(false);
  });

  it("reportNoContact keeps referral_seeking and records the reason on the board", () => {
    const db = openDb(":memory:");
    const a = seed(db);
    takeNextReferral(db, {});
    reportNoContact(db, [a], "no USC alumni or reachable engineers found");
    expect(status(db, a).status).toBe("referral_seeking");
    expect(referralBoard(db)[0].jobs[0].noContactReason).toMatch(/no USC/);
    expect(referralBoard(db)[0].outreach).toBeNull();
  });

  it("createReferralOutreach upserts the person, drafts, links jobs", async () => {
    const db = openDb(":memory:");
    const a = seed(db);
    takeNextReferral(db, {});
    const backend: LlmBackend = { name: "f", complete: async () => ({ text: JSON.stringify({ message: "Hi" }), backend: "f" }) };
    const r = await createReferralOutreach(db, {
      backend,
      profile: parseProfile(yaml),
      jobIds: [a],
      person: { name: "Jane", company: "Google", relation: "alum", linkedin_url: "https://li/jane" },
    });
    expect(outreachJobIds(db, r.outreachId)).toEqual([a]);
    expect(r.draft).toBe("Hi");
    expect(referralBoard(db)[0].outreach?.status).toBe("draft");
  });
});

describe("referralDecide", () => {
  function seeking(db: DB): { a: number; oid: number } {
    const a = seed(db);
    takeNextReferral(db, {});
    const pid = upsertPerson(db, { name: "Jane", company: "Google" });
    const oid = createOutreach(db, { personId: pid, playbook: "referral", channel: "linkedin", draft: "hi", jobIds: [a] });
    return { a, oid };
  }
  const ostatus = (db: DB, id: number) => (db.prepare("SELECT status FROM outreach WHERE id = ?").get(id) as { status: string }).status;

  it("direct: back to matched with apply_mode=direct; unsent draft archived; startMode direct", () => {
    const db = openDb(":memory:");
    const { a, oid } = seeking(db);
    const r = referralDecide(db, { jobIds: [a], action: "direct" });
    expect(r.startMode).toBe("direct");
    expect(status(db, a)).toMatchObject({ status: "matched", apply_mode: "direct", needs_manual_reason: null });
    expect(ostatus(db, oid)).toBe("archived");
  });

  it("won: writes referral_info + person (new name upserted), outreach referral_won, status referral_ready", () => {
    const db = openDb(":memory:");
    const { a, oid } = seeking(db);
    approveOutreach(db, oid);
    reportSent(db, oid);
    const r = referralDecide(db, { jobIds: [a], action: "won", info: { source: "wechat", link: "https://g/ref" }, personName: "Wei" });
    expect(r.startMode).toBe("direct");
    const s = status(db, a);
    expect(s.status).toBe("referral_ready");
    expect(JSON.parse(String(s.referral_info)).link).toBe("https://g/ref");
    const person = db.prepare("SELECT name FROM people WHERE id = ?").get(s.referral_person_id as number) as { name: string };
    expect(person.name).toBe("Wei");
    expect(ostatus(db, oid)).toBe("referral_won");
    // Re-deciding 'won' from referral_ready (the board's 开始投 retry) is idempotent.
    expect(referralDecide(db, { jobIds: [a], action: "won", info: { source: "wechat", link: "https://g/ref" } }).startMode).toBe("direct");
    expect(status(db, a).status).toBe("referral_ready");
  });

  it("won without personName falls back to the outreach's person", () => {
    const db = openDb(":memory:");
    const { a } = seeking(db);
    referralDecide(db, { jobIds: [a], action: "won", info: { source: "linkedin" } });
    const person = db.prepare("SELECT name FROM people WHERE id = ?").get(status(db, a).referral_person_id as number) as { name: string };
    expect(person.name).toBe("Jane");
  });

  it("retry: outreach no_response, job back to matched(referral, pinned), startMode referral", () => {
    const db = openDb(":memory:");
    const { a, oid } = seeking(db);
    approveOutreach(db, oid);
    reportSent(db, oid);
    const r = referralDecide(db, { jobIds: [a], action: "retry" });
    expect(r.startMode).toBe("referral");
    expect(status(db, a)).toMatchObject({ status: "matched", apply_mode: "referral", pinned: 1 });
    expect(ostatus(db, oid)).toBe("no_response");
  });

  it("archive: → archived; rejects jobs not in referral_seeking/referral_ready", () => {
    const db = openDb(":memory:");
    const { a } = seeking(db);
    expect(referralDecide(db, { jobIds: [a], action: "archive" }).startMode).toBeNull();
    expect(status(db, a).status).toBe("archived");
    const plain = seed(db, { company: "Meta" });
    expect(() => referralDecide(db, { jobIds: [plain], action: "direct" })).toThrow(/referral_seeking/);
  });
});
