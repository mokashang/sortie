import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { parseProfile } from "@/lib/profile";
import { upsertPerson, createOutreach } from "@/network/crm";
import { approveOutreach, reportSent } from "@/network/gate";
import { takeNextApplication, reportFill } from "@/apply/queue";
import { takeNextReferral } from "@/apply/referral";
import { startExecutor, claimNextRun, finishRun, StartOptions } from "@/executor/runner";
import {
  DAILY_INVITE_LIMIT,
  dailyInviteLimit,
  invitesUsedToday,
  inviteBudget,
  markInviteCooldown,
  nextLocalMidnight,
  releaseUncontacted,
} from "@/apply/invite-budget";
import { maybeContinueApplyRun, resumePausedChainIfReady, resumeDuePausedChains, maxChainSteps, MIN_CHAIN_STEPS } from "@/apply/continue";
import { planAlerts, resolvePlanAlert, notifyFailedRun } from "@/apply/plan-alerts";

// 2026-10-16: task #453's session stopped a 1530-job plan by itself over LinkedIn pacing and put
// its question in a summary nobody saw; the plan sat idle for 11 hours with 0/1200 direct done.
// Now the App paces referrals (20 LinkedIn invites a day, then direct), only the user stops a
// plan, and a plan that stops short is a 待处理 card plus a push.

const U = "legacy";
const HOUR = 3_600_000;

const profile = parseProfile(`
name: Mengjia Shang
email: mengjia@example.com
phone: "+1-323-244-7662"
linkedin: linkedin.com/in/x
github: github.com/x
school: University of Southern California
degree: M.S. ECE
grad_date: "2027-05"
work_auth: { status: F-1, needs_sponsorship: true }
targets: { primary: newgrad }
directions: { swe_general: 1 }
`);

let seq = 0;
function seedJob(db: DB, opts: { company?: string; mode?: "referral" | "direct"; status?: string; score?: number } = {}): number {
  seq += 1;
  const id = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(`fp-ib-${seq}`, opts.company ?? `Co${seq}`, "SWE New Grad", `https://co${seq}.example/apply`, "greenhouse", "manual", "2026-01-01 00:00:00")
    .lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(id, "swe_general", opts.score ?? 80, 1);
  db.prepare("INSERT INTO applications (job_id, status, apply_mode) VALUES (?,?,?)").run(id, opts.status ?? "matched", opts.mode ?? "direct");
  return id;
}

function seedResume(db: DB): void {
  db.prepare("INSERT INTO resumes (version_name, directions, pdf_path, compiled_at) VALUES (?,?,?,?)").run(
    "swe_general_v1",
    JSON.stringify(["swe_general"]),
    "/data/r/swe_general_v1.pdf",
    "2026-01-01 00:00:00"
  );
}

let personSeq = 0;
// One referral contact on LinkedIn. sentAt: when the first message went out (null = still a draft).
function contact(db: DB, opts: { sentAt?: number | null; channel?: "linkedin" | "email"; archived?: boolean } = {}): number {
  personSeq += 1;
  const pid = upsertPerson(db, U, { name: `Person ${personSeq}`, company: "Acme", relation: "alum", linkedin_url: `https://li/p${personSeq}` });
  const oid = createOutreach(db, U, { personId: pid, playbook: "referral", channel: opts.channel ?? "linkedin", draft: "full", draftNote: "note" });
  if (opts.archived) db.prepare("UPDATE outreach SET status = 'archived' WHERE id = ?").run(oid);
  if (opts.sentAt != null) {
    approveOutreach(db, U, oid);
    reportSent(db, U, oid, "note");
    db.prepare("UPDATE outreach SET thread_log = json_set(thread_log, '$[0].at', ?) WHERE id = ?").run(new Date(opts.sentAt).toISOString(), oid);
  }
  return oid;
}

function runRow(db: DB, id: number) {
  return db.prepare("SELECT status, options, summary FROM executor_runs WHERE id = ?").get(id) as { status: string; options: string; summary: string | null };
}
const optionsOf = (db: DB, id: number) => JSON.parse(runRow(db, id).options) as StartOptions & { notBefore?: string };

describe("daily LinkedIn invite budget", () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(":memory:");
    seedOwner(db, U);
  });
  afterEach(() => {
    db.close();
    vi.unstubAllEnvs();
  });

  it("counts first LinkedIn messages sent today and today's unsent drafts — not yesterday's, archived drafts or email", () => {
    const now = new Date();
    contact(db, { sentAt: now.getTime() });
    contact(db, { sentAt: now.getTime() - 60_000 });
    contact(db, { sentAt: null }); // drafted today: promised, counts
    contact(db, { sentAt: now.getTime() - 30 * HOUR }); // yesterday or earlier
    contact(db, { sentAt: null, archived: true }); // the user said no
    contact(db, { sentAt: now.getTime(), channel: "email" });
    expect(invitesUsedToday(db, U, now)).toBe(3);
    expect(inviteBudget(db, U, now)).toMatchObject({ limit: DAILY_INVITE_LIMIT, used: 3, left: DAILY_INVITE_LIMIT - 3, exhausted: false, cooldownUntil: null });
    expect(inviteBudget(db, U, now).resetsAt).toBe(nextLocalMidnight(now).toISOString());
  });

  it("LinkedIn's own slow-down zeroes today's budget until midnight", () => {
    const now = new Date();
    const b = markInviteCooldown(db, U, "weekly invitation limit reached", now);
    expect(b).toMatchObject({ used: 0, left: 0, exhausted: true, cooldownUntil: nextLocalMidnight(now).toISOString() });
    expect(inviteBudget(db, U, new Date(nextLocalMidnight(now).getTime() + 1000)).exhausted).toBe(false);
  });

  it("LINKEDIN_DAILY_INVITES overrides the limit; empty or junk keeps 20", () => {
    expect(dailyInviteLimit({ LINKEDIN_DAILY_INVITES: "12" })).toBe(12);
    expect(dailyInviteLimit({ LINKEDIN_DAILY_INVITES: "" })).toBe(DAILY_INVITE_LIMIT);
    expect(dailyInviteLimit({ LINKEDIN_DAILY_INVITES: "lots" })).toBe(DAILY_INVITE_LIMIT);
    expect(dailyInviteLimit({})).toBe(20);
  });

  it("a batch referral pick past the budget claims nothing and says why; the user's targeted pick still goes; maxPeople shrinks to what is left", () => {
    vi.stubEnv("LINKEDIN_DAILY_INVITES", "2");
    const a = seedJob(db, { company: "Apple", mode: "referral" });
    seedJob(db, { company: "Nuro", mode: "referral" });
    contact(db, { sentAt: Date.now() });

    const first = takeNextReferral(db, U, { direction: "swe_general" });
    expect(first).toMatchObject({ company: "Apple", maxPeople: 1, inviteBudget: { used: 1, left: 1 } });

    contact(db, { sentAt: Date.now() });
    const none = takeNextReferral(db, U, { direction: "swe_general" });
    expect(none).toMatchObject({ done: true, reason: "invite_budget", inviteBudget: { exhausted: true } });
    expect(db.prepare("SELECT COUNT(*) n FROM applications WHERE status = 'referral_seeking'").get()).toEqual({ n: 1 });

    db.prepare("UPDATE applications SET status = 'matched' WHERE job_id = ?").run(a);
    expect(takeNextReferral(db, U, { jobIds: [a] })).toMatchObject({ company: "Apple", maxPeople: 3 });
  });

  it("a company nobody was asked at goes back to the queue when the budget runs out under it", () => {
    const asked = seedJob(db, { status: "referral_seeking", mode: "referral" });
    const nobody = seedJob(db, { status: "referral_seeking", mode: "referral" });
    const pid = upsertPerson(db, U, { name: "Ann", company: "Acme" });
    createOutreach(db, U, { personId: pid, playbook: "referral", channel: "linkedin", draft: "x", jobIds: [asked] });
    expect(releaseUncontacted(db, U, [asked, nobody])).toEqual([nobody]);
    expect((db.prepare("SELECT status FROM applications WHERE job_id = ?").get(nobody) as { status: string }).status).toBe("matched");
  });
});

describe("plan pacing and who may end a plan", () => {
  let db: DB;
  let logDir: string;
  const pushes: string[] = [];
  const push = (title: string, body: string) => void pushes.push(`${title} | ${body}`);

  beforeEach(() => {
    db = openDb(":memory:");
    seedOwner(db, U);
    seedResume(db);
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), "invite-budget-"));
    pushes.length = 0;
  });
  afterEach(() => {
    db.close();
    fs.rmSync(logDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function startSegment(options: StartOptions): number {
    const { id } = startExecutor(db, U, "apply", options, { logDir, queueBehind: true }, "user_chrome");
    expect(claimNextRun(db, U, "user_chrome")?.id).toBe(id);
    return id;
  }
  function fill(jobIds?: number[]): number {
    const task = takeNextApplication(db, U, profile, jobIds ? { jobIds } : { direction: "swe_general" }) as { jobId: number };
    reportFill(db, U, { jobId: task.jobId, status: "awaiting_confirm", filledFields: { Name: "Mengjia Shang" } });
    return task.jobId;
  }

  it("with only referral entries left and no invites left today, the next segment waits for midnight — no zero-progress strike", () => {
    vi.stubEnv("LINKEDIN_DAILY_INVITES", "1");
    seedJob(db, { mode: "referral" });
    contact(db, { sentAt: Date.now() });
    const a = startSegment({ plan: [{ direction: "swe_general", count: 3, mode: "referral" }], chunk: 10 });
    expect(takeNextReferral(db, U, { direction: "swe_general", runId: a })).toMatchObject({ reason: "invite_budget" });
    finishRun(db, U, a, "done");

    const r = maybeContinueApplyRun(db, a, { logDir, notify: push }) as { action: string; runId: number; until: string };
    expect(r.action).toBe("paused");
    expect(r.until).toBe(nextLocalMidnight(new Date()).toISOString());
    expect(runRow(db, r.runId)).toMatchObject({ status: "paused", summary: expect.stringContaining("邀请额度") });
    expect(optionsOf(db, r.runId)).toMatchObject({ notBefore: r.until, plan: [{ direction: "swe_general", count: 3, mode: "referral" }], chain: { step: 2, zeroRuns: 0 } });
    expect(pushes).toEqual([]);

    // Not before its time — not even when the confirmation backlog is empty.
    expect(resumePausedChainIfReady(db, U, { logDir })).toMatchObject({ action: "none", reason: "paused chain waits for tomorrow" });
    expect(resumeDuePausedChains(db, { logDir })).toEqual([]);
    // After midnight the dispatcher tick hands it to a session, same id.
    const later = Date.parse(r.until) + 60_000;
    expect(resumeDuePausedChains(db, { logDir, now: later })).toEqual([{ action: "queued", runId: r.runId, channel: "user_chrome" }]);
    expect(runRow(db, r.runId).status).toBe("queued");
  });

  it("with direct entries left the plan just goes on: referrals wait for tomorrow inside each segment", () => {
    vi.stubEnv("LINKEDIN_DAILY_INVITES", "0");
    seedJob(db, { mode: "referral" });
    seedJob(db, { score: 95 });
    seedJob(db, { score: 90 });
    const a = startSegment({
      plan: [
        { direction: "swe_general", count: 2, mode: "referral" },
        { direction: "swe_general", count: 2, mode: "direct" },
      ],
      chunk: 1,
    });
    expect(takeNextReferral(db, U, { direction: "swe_general", runId: a })).toMatchObject({ reason: "invite_budget" });
    fill();
    finishRun(db, U, a, "done");
    const r = maybeContinueApplyRun(db, a, { logDir, notify: push }) as { action: string; runId: number };
    expect(r.action).toBe("queued");
    expect(optionsOf(db, r.runId).plan).toEqual([
      { direction: "swe_general", count: 2, mode: "referral" },
      { direction: "swe_general", count: 1, mode: "direct" },
    ]);
  });

  it("the chain's length cap grows with the plan (a 1530-job plan at 10 a segment is not cut at 300)", () => {
    expect(maxChainSteps({ direct: 1200, referral: 330 }, 10)).toBe(316);
    expect(maxChainSteps({ direct: 20, referral: 0 }, 10)).toBe(MIN_CHAIN_STEPS);
  });

  it("a plan that stops short pushes and leaves a card; 继续跑剩下的 queues the rest as a new plan and the card goes", () => {
    const a = startSegment({ plan: [{ direction: "swe_general", count: 5, mode: "direct" }], chunk: 10 });
    finishRun(db, U, a, "done", "queue empty");
    const b = (maybeContinueApplyRun(db, a, { logDir, notify: push }) as { runId: number }).runId;
    expect(claimNextRun(db, U, "user_chrome")?.id).toBe(b);
    finishRun(db, U, b, "done", "still empty");
    expect(maybeContinueApplyRun(db, b, { logDir, notify: push })).toMatchObject({ action: "none", reason: expect.stringContaining("no progress") });
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toMatch(/#\d+/);

    const alerts = planAlerts(db, U);
    expect(alerts).toEqual([
      expect.objectContaining({ runId: b, kind: "chain", root: a, reason: "no_progress", remaining: [{ direction: "swe_general", count: 5, mode: "direct" }], summary: "still empty" }),
    ]);
    const { runId } = resolvePlanAlert(db, U, b, "continue");
    expect(runRow(db, runId!).status).toBe("queued");
    expect(optionsOf(db, runId!)).toMatchObject({ plan: [{ direction: "swe_general", count: 5, mode: "direct" }], chunk: 10 });
    expect(planAlerts(db, U)).toEqual([]);
    expect(() => resolvePlanAlert(db, U, b, "dismiss")).toThrow(/nothing waiting/);
  });

  it("a targeted task that gave up with jobs untouched is a card and a push; 再试一次 queues just those jobs", () => {
    const [j1, j2, j3] = [seedJob(db, { score: 95 }), seedJob(db, { score: 90 }), seedJob(db, { score: 85 })];
    const a = startSegment({ jobIds: [j1, j2, j3], mode: "direct" });
    fill([j1]);
    finishRun(db, U, a, "failed", "Submit is blocked by session permissions");
    expect(notifyFailedRun(db, U, a, push)).toBe(true);
    expect(pushes[0]).toContain(`#${a}`);

    const [alert] = planAlerts(db, U);
    expect(alert).toMatchObject({ runId: a, kind: "failed", untouched: [j2, j3], total: 3, mode: "direct", summary: expect.stringContaining("blocked") });
    const { runId } = resolvePlanAlert(db, U, a, "continue");
    expect(optionsOf(db, runId!)).toMatchObject({ jobIds: [j2, j3], mode: "direct" });
    expect(planAlerts(db, U)).toEqual([]);
  });

  it("不用了 dismisses a card without queueing anything; a failed task with nothing left untouched never shows one", () => {
    const j1 = seedJob(db, { score: 95 });
    const a = startSegment({ jobIds: [j1], mode: "direct" });
    fill([j1]);
    finishRun(db, U, a, "failed", "late error");
    expect(planAlerts(db, U)).toEqual([]);
    expect(notifyFailedRun(db, U, a, push)).toBe(false);

    const j2 = seedJob(db, { score: 90 });
    const b = startSegment({ jobIds: [j2], mode: "direct" });
    finishRun(db, U, b, "failed", "gave up");
    expect(planAlerts(db, U).map((x) => x.runId)).toEqual([b]);
    expect(resolvePlanAlert(db, U, b, "dismiss")).toEqual({ runId: null });
    expect(planAlerts(db, U)).toEqual([]);
  });
});
