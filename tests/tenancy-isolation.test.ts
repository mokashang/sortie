import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { importProfileYaml, loadProfile } from "@/lib/profile";
import { upsertJobs } from "@/scanner/upsert";
import { runMatching } from "@/matcher/run";
import { takeNextApplication, pendingConfirmations, reportFill, queueByDirection, setPinned, archiveFromQueue, getApplyTask } from "@/apply/queue";
import { upsertPerson, createOutreach, listPeople, listOutreach } from "@/network/crm";
import { approveOutreach, sendables, reportSent } from "@/network/gate";
import { createExperience, listExperiences, updateExperience } from "@/resume/experiences";
import { startExecutor, claimNextRun, executorStatus, finishRun, appendRunLog } from "@/executor/runner";
import { applicationHistory, setStage } from "@/apply/history";
import { overview } from "@/apply/overview";
import { funnel } from "@/network/stats";
import { seedUser } from "./helpers";
import type { LlmBackend } from "@/llm/types";

// Two accounts share one library of jobs and must never see each other's scores, queue,
// applications, contacts, drafts, experiences or runs (spec 2026-09-13 accounts §3).

const yaml = (name: string, email: string) => `
name: ${name}
email: ${email}
phone: "1"
linkedin: ""
github: ""
school: USC
degree: MS
grad_date: "2027-05"
work_auth: { status: F-1, needs_sponsorship: true }
targets: { primary: newgrad }
directions: { swe_general: 1 }
`;

function backendScoring(score: number): LlmBackend {
  return {
    name: "fake",
    complete: async (req) => {
      const ids = [...req.prompt.matchAll(/<job id="(\d+)"/g)].map((m) => Number(m[1]));
      return {
        text: JSON.stringify(ids.map((id) => ({ job_id: id, direction: "swe_general", score, reason: "ok", skip: false, sponsorship: "unknown", degree: "ms_ok", role: "eng" }))),
        backend: "fake",
      };
    },
  };
}

function setup(): { db: DB; a: string; b: string } {
  const db = openDb(":memory:");
  seedUser(db, "ann", "ann@example.com", { role: "owner" });
  seedUser(db, "bob", "bob@example.com");
  importProfileYaml(db, "ann", yaml("Ann", "ann@example.com"));
  importProfileYaml(db, "bob", yaml("Bob", "bob@example.com"));
  upsertJobs(db, [
    { company: "Stripe", title: "SWE", location: "SF", jdText: "Build things " + "x".repeat(50), applyUrl: "https://stripe.example/1", source: "greenhouse", ats: "greenhouse", postedAt: null },
    { company: "Datadog", title: "SRE", location: "NY", jdText: "Run things " + "x".repeat(50), applyUrl: "https://dd.example/2", source: "greenhouse", ats: "greenhouse", postedAt: null },
  ]);
  return { db, a: "ann", b: "bob" };
}

describe("tenancy isolation", () => {
  it("scanner writes one applications row per account per job; matching scores per account", async () => {
    const { db, a, b } = setup();
    expect((db.prepare("SELECT COUNT(*) n FROM applications").get() as { n: number }).n).toBe(4);
    const profile = loadProfile(db, a);
    await runMatching(db, { userId: a, backend: backendScoring(90), profile: { directions: profile.directions, work_auth: profile.work_auth } });
    expect(queueByDirection(db, a).reduce((n, g) => n + g.matched, 0)).toBe(2);
    expect(queueByDirection(db, b)).toEqual([]);
    await runMatching(db, { userId: b, backend: backendScoring(30), profile: { directions: profile.directions, work_auth: profile.work_auth } });
    // Bob's low scores archive Bob's rows only.
    expect(queueByDirection(db, a).reduce((n, g) => n + g.matched, 0)).toBe(2);
    expect(queueByDirection(db, b)).toEqual([]);
    expect(funnel(db, b).archived).toBe(2);
    expect(funnel(db, a).archived).toBe(0);
  });

  it("the apply pipeline, contacts, drafts, experiences, runs and history stay inside the account", async () => {
    const { db, a, b } = setup();
    for (const u of [a, b]) {
      const profile = loadProfile(db, u);
      await runMatching(db, { userId: u, backend: backendScoring(85), profile: { directions: profile.directions, work_auth: profile.work_auth } });
      db.prepare("INSERT INTO resumes (user_id, version_name, directions, pdf_path, compiled_at) VALUES (?, 'v1', '[\"swe_general\"]', '/r.pdf', '2026-01-01')").run(u);
    }
    // Ann pins Datadog; Bob's queue order is untouched.
    const dd = (db.prepare("SELECT id FROM jobs WHERE company = 'Datadog'").get() as { id: number }).id;
    setPinned(db, a, dd, true);
    const annTask = takeNextApplication(db, a, loadProfile(db, a));
    expect("jobId" in annTask && annTask.jobId).toBe(dd);
    const bobTask = takeNextApplication(db, b, loadProfile(db, b));
    expect("jobId" in bobTask && bobTask.company).toBe("Stripe");
    // The same job is 'prepared' for Ann and still 'matched' for Bob.
    expect(getApplyTask(db, b, dd)).toMatchObject({ error: expect.stringContaining("not prepared") });
    reportFill(db, a, { jobId: dd, status: "awaiting_confirm", filledFields: { email: "ann@example.com" } });
    expect(pendingConfirmations(db, a).map((p) => p.jobId)).toEqual([dd]);
    expect(pendingConfirmations(db, b)).toEqual([]);
    expect(() => reportFill(db, b, { jobId: dd, status: "awaiting_confirm", filledFields: {} })).toThrow();
    // Archiving from Bob's queue does not touch Ann's row for the same job.
    const stripe = (db.prepare("SELECT id FROM jobs WHERE company = 'Stripe'").get() as { id: number }).id;
    expect(() => archiveFromQueue(db, b, stripe)).toThrow(); // Bob took it (prepared)
    expect(() => archiveFromQueue(db, a, stripe)).not.toThrow();

    // Contacts and drafts.
    const pa = upsertPerson(db, a, { name: "Jane", company: "Stripe", linkedin_url: "in/jane" });
    const pb = upsertPerson(db, b, { name: "Jane", company: "Stripe", linkedin_url: "in/jane" });
    expect(pa).not.toBe(pb); // same LinkedIn URL, one row per account
    expect(listPeople(db, a).map((p) => p.id)).toEqual([pa]);
    expect(() => createOutreach(db, b, { personId: pa, playbook: "coffee_chat", channel: "linkedin", draft: "x" })).toThrow(/unknown person/);
    const oa = createOutreach(db, a, { personId: pa, playbook: "coffee_chat", channel: "linkedin", draft: "hi" });
    expect(() => approveOutreach(db, b, oa)).toThrow(/unknown outreach/);
    approveOutreach(db, a, oa);
    expect(sendables(db, b)).toEqual([]);
    expect(sendables(db, a).map((s) => s.id)).toEqual([oa]);
    expect(() => reportSent(db, b, oa)).toThrow();
    expect(listOutreach(db, b)).toEqual([]);

    // Experiences.
    const ea = createExperience(db, a, { kind: "work", title: "Ann's job", bullets: [], sort_order: 0 });
    expect(listExperiences(db, b)).toEqual([]);
    expect(() => updateExperience(db, b, ea, { kind: "work", title: "hijack", bullets: [], sort_order: 0 })).toThrow(/unknown/);
    expect(listExperiences(db, a)[0].title).toBe("Ann's job");

    // Runs.
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "tenancy-"));
    const run = startExecutor(db, a, "apply", {}, { logDir }, "user_chrome");
    expect(claimNextRun(db, b, "user_chrome")).toBeNull();
    expect(() => appendRunLog(db, b, run.id, "nope")).toThrow(/no run/);
    expect(() => finishRun(db, b, run.id, "done")).toThrow(/no run/);
    expect(executorStatus(db, b)).toEqual([]);
    expect(claimNextRun(db, a, "user_chrome")?.id).toBe(run.id);
    finishRun(db, a, run.id, "done");

    // History and overview.
    db.prepare("UPDATE applications SET status = 'submitted', submitted_at = datetime('now') WHERE user_id = ? AND job_id = ?").run(a, dd);
    setStage(db, a, dd, "oa");
    expect(() => setStage(db, b, dd, "oa")).toThrow();
    expect(applicationHistory(db, a)).toHaveLength(1);
    expect(applicationHistory(db, b)).toHaveLength(0);
    const oa2 = overview(db, a);
    const ob = overview(db, b);
    expect(oa2.counts.submittedToday).toBe(1);
    expect(ob.counts.submittedToday).toBe(0);
    expect(oa2.profileComplete).toBe(true);
    expect(oa2.assistant?.id).toBe(run.id);
    expect(ob.assistant).toBeNull();
    fs.rmSync(logDir, { recursive: true, force: true });
  });
});
