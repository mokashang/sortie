import { describe, it, expect } from "vitest";
import { openDb, type DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { applyMailResult, decideStage, inboxNotification, mentionsCompany, MIN_CONFIDENCE, UNVERIFIED_CONFIDENCE } from "@/inbox/apply";
import { recentMailEvents, latestMailByJob, countMailEvents, submittedApplications, earliestSubmissionUnix, upsertMailAccount } from "@/inbox/store";
import { applicationHistory } from "@/apply/history";
import type { ParsedMail } from "@/inbox/google";

const U = "legacy";
// Every test seeds one mailbox; applyMailResult records events against it.
const BOX = 1;

function seedJob(db: DB, opts: { company?: string; title?: string; status?: string; submittedAt?: string | null } = {}): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, opts.company ?? "Acme", opts.title ?? "SWE", "https://acme.example/apply", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (user_id, job_id, direction, score, tier) VALUES (?,?,?,?,?)").run(U, jobId, "swe_general", 80, 1);
  db.prepare("INSERT INTO applications (user_id, job_id, status, submitted_at) VALUES (?,?,?,?)").run(
    U,
    jobId,
    opts.status ?? "submitted",
    opts.submittedAt === undefined ? "2026-09-02 10:00:00" : opts.submittedAt
  );
  return jobId;
}

function mail(id: string, extra: Partial<ParsedMail> = {}): ParsedMail {
  return { id, threadId: `t-${id}`, from: "Acme <no-reply@greenhouse.io>", subject: `About your Acme application`, receivedAtMs: Date.parse("2026-09-20T21:00:00Z"), snippet: "snip", text: "body", ...extra };
}

function status(db: DB, jobId: number): string {
  return (db.prepare("SELECT status FROM applications WHERE user_id = ? AND job_id = ?").get(U, jobId) as { status: string }).status;
}

describe("inbox/apply decideStage", () => {
  it("climbs the ladder, never descends, and lets rejections land anywhere short of a decided offer", () => {
    expect(decideStage("submitted", "interview", 0.9)).toBe("interview");
    expect(decideStage("submitted", "oa", 0.9)).toBe("oa");
    expect(decideStage("oa", "interview", 0.9)).toBe("interview");
    expect(decideStage("interview", "oa", 0.9)).toBeNull();
    expect(decideStage("interview", "interview", 0.9)).toBeNull();
    expect(decideStage("offer", "interview", 0.9)).toBeNull();
    expect(decideStage("interview", "offer", 0.9)).toBe("offer");
    expect(decideStage("submitted", "rejected", 0.9)).toBe("rejected");
    expect(decideStage("interview", "rejected", 0.9)).toBe("rejected");
    expect(decideStage("offer", "rejected", 0.9)).toBe("rejected");
    expect(decideStage("rejected", "rejected", 0.9)).toBeNull();
    expect(decideStage("rejected", "interview", 0.9)).toBeNull();
    expect(decideStage("stale", "interview", 0.9)).toBe("interview");
    expect(decideStage("offer_accepted", "rejected", 0.99)).toBeNull();
    expect(decideStage("offer_declined", "offer", 0.99)).toBeNull();
    expect(decideStage("submitted", "received", 0.99)).toBeNull();
    expect(decideStage("submitted", "other", 0.99)).toBeNull();
    expect(decideStage("submitted", "unrelated", 0.99)).toBeNull();
    expect(decideStage("submitted", "interview", MIN_CONFIDENCE - 0.01)).toBeNull();
    expect(decideStage("matched", "interview", 0.99)).toBeNull();
  });
});

describe("inbox/apply applyMailResult", () => {
  it("moves the application through setStage with a note, records the event, and surfaces the mail on 历史", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    expect(upsertMailAccount(db, { userId: U, email: "me@example.com", refreshToken: "rt", scope: null }).id).toBe(BOX);
    const jobId = seedJob(db, { company: "Datadog", title: "SWE Intern" });
    const a = applyMailResult(db, U, BOX, mail("m1", { subject: "Datadog interview" }), {
      message_id: "m1",
      job_id: jobId,
      outcome: "interview",
      confidence: 0.92,
      summary: "Invites you to a 45-minute technical phone screen.",
      next_step: "Pick a slot before Sep 26",
    });
    expect(a).toMatchObject({ jobId, company: "Datadog", applied: true, stageFrom: "submitted", stageTo: "interview", notify: true });
    expect(status(db, jobId)).toBe("interview");
    const ev = db.prepare("SELECT payload FROM events WHERE kind = 'application_stage' AND entity_id = ?").get(jobId) as { payload: string };
    expect(JSON.parse(ev.payload)).toEqual({ from: "submitted", to: "interview", note: "Invites you to a 45-minute technical phone screen. [Datadog interview]" });

    const row = applicationHistory(db, U).find((r) => r.jobId === jobId)!;
    expect(row.status).toBe("interview");
    expect(row.lastMail).toMatchObject({ outcome: "interview", applied: true, subject: "Datadog interview", nextStep: "Pick a slot before Sep 26" });
    expect(row.lastNote).toContain("phone screen");
    expect(latestMailByJob(db, U).get(jobId)?.messageId).toBe("m1");
    expect(countMailEvents(db, U)).toEqual({ total: 1, matched: 1, applied: 1 });

    const n = inboxNotification("zh", a);
    expect(n.title).toBe("Sortie · Datadog → 面试");
    expect(n.body).toContain("SWE Intern");
    expect(n.body).toContain("下一步:Pick a slot before Sep 26");
    expect(inboxNotification("en", a).title).toBe("Sortie · Datadog → Interview");
  });

  it("records without moving when confidence is low, when the row already stands higher, or when the mail is informational", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    expect(upsertMailAccount(db, { userId: U, email: "me@example.com", refreshToken: "rt", scope: null }).id).toBe(BOX);
    const jobId = seedJob(db, { status: "interview" });
    const low = applyMailResult(db, U, BOX, mail("m1"), { message_id: "m1", job_id: jobId, outcome: "offer", confidence: 0.4, summary: "maybe an offer", next_step: null });
    expect(low.applied).toBe(false);
    expect(low.notify).toBe(false);
    const lower = applyMailResult(db, U, BOX, mail("m2"), { message_id: "m2", job_id: jobId, outcome: "oa", confidence: 0.95, summary: "OA link", next_step: "Finish the OA" });
    expect(lower.applied).toBe(false);
    expect(lower.notify).toBe(true); // actionable + confident: worth a push even though the stage stays
    const ack = applyMailResult(db, U, BOX, mail("m3"), { message_id: "m3", job_id: jobId, outcome: "received", confidence: 0.99, summary: "Received", next_step: null });
    expect(ack.applied).toBe(false);
    expect(ack.notify).toBe(false);
    expect(status(db, jobId)).toBe("interview");
    expect(db.prepare("SELECT COUNT(*) as n FROM events WHERE kind = 'application_stage'").get()).toEqual({ n: 0 });
    expect(recentMailEvents(db, U).map((e) => e.messageId)).toEqual(["m3", "m2", "m1"]);
  });

  it("files a job the user never submitted (or another account's) as unmatched", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    expect(upsertMailAccount(db, { userId: U, email: "me@example.com", refreshToken: "rt", scope: null }).id).toBe(BOX);
    const queued = seedJob(db, { status: "matched", submittedAt: null });
    const a = applyMailResult(db, U, BOX, mail("m1"), { message_id: "m1", job_id: queued, outcome: "rejected", confidence: 0.9, summary: "Declined", next_step: null });
    expect(a).toMatchObject({ jobId: null, applied: false, outcome: "rejected", notify: false });
    expect(status(db, queued)).toBe("matched");
    const other = applyMailResult(db, U, BOX, mail("m2"), { message_id: "m2", job_id: 999999, outcome: "received", confidence: 0.9, summary: "Ack", next_step: null });
    expect(other.outcome).toBe("unrelated");
    // a second sighting of the same message is a no-op
    applyMailResult(db, U, BOX, mail("m1"), { message_id: "m1", job_id: queued, outcome: "rejected", confidence: 0.9, summary: "Declined", next_step: null });
    expect(countMailEvents(db, U).total).toBe(2);
  });

  it("refuses to move a row when the mail never names the matched company (a swapped id or a guess)", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    expect(upsertMailAccount(db, { userId: U, email: "me@example.com", refreshToken: "rt", scope: null }).id).toBe(BOX);
    const whatnot = seedJob(db, { company: "Whatnot", title: "SWE New Grad" });
    const lensa = mail("lensa", { from: "Lensa 24 <lensa24@lensa.com>", subject: "Software Engineer - Intern jobs in Los Angeles", text: "jobs posted September 20" });
    const a = applyMailResult(db, U, BOX, lensa, { message_id: "lensa", job_id: whatnot, outcome: "rejected", confidence: 0.95, summary: "Whatnot rejected the application.", next_step: null });
    expect(a).toMatchObject({ jobId: whatnot, applied: false, notify: false });
    expect(status(db, whatnot)).toBe("submitted");
    expect(db.prepare("SELECT confidence FROM mail_events WHERE message_id = 'lensa'").get()).toEqual({ confidence: UNVERIFIED_CONFIDENCE });
    // the real mail names the company in the sender and goes through
    const real = mail("wn", { from: "Whatnot Hiring Team <no-reply@ashbyhq.com>", subject: "Follow-up from Whatnot", text: "we will not be moving forward" });
    expect(applyMailResult(db, U, BOX, real, { message_id: "wn", job_id: whatnot, outcome: "rejected", confidence: 0.95, summary: "Declined", next_step: null }).applied).toBe(true);
    expect(mentionsCompany({ from: "a@b.c", subject: "x", text: "Thanks from the Scale AI team" }, "Scale AI")).toBe(true);
    expect(mentionsCompany({ from: "a@b.c", subject: "x", text: "nothing here" }, "Scale AI")).toBe(false);
  });

  it("does not touch an accepted offer, even for a confident rejection", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    expect(upsertMailAccount(db, { userId: U, email: "me@example.com", refreshToken: "rt", scope: null }).id).toBe(BOX);
    const jobId = seedJob(db, { status: "offer_accepted" });
    const a = applyMailResult(db, U, BOX, mail("m1"), { message_id: "m1", job_id: jobId, outcome: "rejected", confidence: 0.99, summary: "Rescinded", next_step: null });
    expect(a.applied).toBe(false);
    expect(status(db, jobId)).toBe("offer_accepted");
  });
});

describe("inbox/store submittedApplications", () => {
  it("lists only this account's submitted rows, newest first, with the earliest submission time", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    expect(upsertMailAccount(db, { userId: U, email: "me@example.com", refreshToken: "rt", scope: null }).id).toBe(BOX);
    const a = seedJob(db, { company: "A", submittedAt: "2026-09-01 08:00:00" });
    const b = seedJob(db, { company: "B", status: "rejected", submittedAt: "2026-09-05 08:00:00" });
    seedJob(db, { company: "C", status: "matched", submittedAt: null });
    expect(submittedApplications(db, U).map((r) => r.jobId)).toEqual([b, a]);
    expect(submittedApplications(db, U)[0]).toMatchObject({ company: "B", status: "rejected", submittedAt: expect.stringMatching(/^2026-09-0[45]$/) });
    expect(earliestSubmissionUnix(db, U)).toBe(Math.floor(Date.parse("2026-09-01T08:00:00Z") / 1000));
    expect(submittedApplications(db, "someone-else")).toEqual([]);
    expect(earliestSubmissionUnix(db, "someone-else")).toBeNull();
  });
});
