import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
// The routes reach the database through getDb(): a private in-memory db, never data/jobseeker.db.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const db = actual.openDb(":memory:");
  return { ...actual, getDb: () => db };
});
import { getDb } from "@/lib/db";
import { startExecutor, claimNextRun } from "@/executor/runner";
import { POST as postFinishRoute } from "@/app/api/executor/finish/route";
import { POST as postNextRoute } from "@/app/api/apply/next/route";
import { POST as postOutreachRoute } from "@/app/api/referral/outreach/route";
import { GET as getBudgetRoute, POST as postBudgetRoute } from "@/app/api/referral/invite-budget/route";
import { resetInternalTokenCacheForTests } from "@/lib/internal-token";
import { seedOwner } from "./helpers";

const CTX = { params: Promise.resolve({}) };
const U = "legacy";
const TOKEN = "sortie_internal_budget_0123456789abcdef";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-budget-data-"));
process.env.SORTIE_INTERNAL_TOKEN = TOKEN;
resetInternalTokenCacheForTests();
seedOwner(getDb(), U);

const req = (url: string, body?: unknown) =>
  new Request(`http://127.0.0.1:3000${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const logDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "sortie-budget-"));

let seq = 0;
function seedJob(status: string, mode = "referral"): number {
  const db = getDb();
  seq += 1;
  const id = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-br-${seq}`, `Co${seq}`, "SWE", "https://x.example/apply", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(id, "swe_general", 90, 1);
  db.prepare("INSERT INTO applications (job_id, status, apply_mode) VALUES (?,?,?)").run(id, status, mode);
  return id;
}

afterEach(() => vi.unstubAllEnvs());

describe("only the user ends a plan; the App paces referrals (2026-10-16, task #453)", () => {
  it("a session's own 'stopped' is recorded as done and the plan goes on", async () => {
    const db = getDb();
    const run = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 5, mode: "direct" }], chunk: 10 }, { logDir: logDir(), queueBehind: true }, "user_chrome");
    expect(claimNextRun(db, U, "user_chrome")?.id).toBe(run.id);
    const res = await postFinishRoute(req("/api/executor/finish", { runId: run.id, status: "stopped", summary: "pausing so the user can decide the pace" }), CTX);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, recordedAs: "done", continuation: { action: "queued" } });
    expect(db.prepare("SELECT status FROM executor_runs WHERE id = ?").get(run.id)).toEqual({ status: "done" });
    expect(db.prepare("SELECT COUNT(*) n FROM events WHERE kind = 'run_stop_by_session_ignored' AND entity_id = ?").get(run.id)).toEqual({ n: 1 });
    // Free the slot for the next tests.
    db.prepare("UPDATE executor_runs SET status = 'stopped' WHERE status IN ('queued','running','paused')").run();
  });

  it("a referral pick past today's budget answers invite_budget with a message to go do the direct entries", async () => {
    vi.stubEnv("LINKEDIN_DAILY_INVITES", "0");
    seedJob("matched");
    const res = await postNextRoute(req("/api/apply/next", { direction: "swe_general", mode: "referral" }), CTX);
    const j = await res.json();
    expect(j).toMatchObject({ done: true, reason: "invite_budget", inviteBudget: { limit: 0, exhausted: true } });
    expect(j.message).toMatch(/direct/);
    expect(j.message).toMatch(/do not stop the task/);
  });

  it("drafting for a batch company past the budget is refused (409) and a company nobody was asked at goes back to the queue", async () => {
    vi.stubEnv("LINKEDIN_DAILY_INVITES", "0");
    const db = getDb();
    const plan = startExecutor(db, U, "apply", { plan: [{ direction: "swe_general", count: 3, mode: "referral" }], chunk: 10 }, { logDir: logDir(), queueBehind: true }, "user_chrome");
    const jobId = seedJob("referral_seeking");
    db.prepare("UPDATE applications SET run_id = ? WHERE job_id = ?").run(plan.id, jobId);
    const res = await postOutreachRoute(
      req("/api/referral/outreach", { jobIds: [jobId], person: { name: "Ann Lee", company: "Co", relation: "alum", linkedin_url: "https://li/ann" }, channel: "linkedin" }),
      CTX
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "invite_budget_exhausted", released: [jobId] });
    expect(db.prepare("SELECT status, run_id FROM applications WHERE job_id = ?").get(jobId)).toEqual({ status: "matched", run_id: null });
    db.prepare("UPDATE executor_runs SET status = 'stopped' WHERE status IN ('queued','running','paused')").run();
  });

  it("the session can report LinkedIn's own slow-down; the budget reads zero until midnight", async () => {
    const before = await (await getBudgetRoute(req("/api/referral/invite-budget"), CTX)).json();
    expect(before).toMatchObject({ limit: 20, exhausted: false });
    expect((await postBudgetRoute(req("/api/referral/invite-budget", { reason: "x" }), CTX)).status).toBe(400);
    const after = await (await postBudgetRoute(req("/api/referral/invite-budget", { limited: true, reason: "weekly invitation limit" }), CTX)).json();
    expect(after).toMatchObject({ left: 0, exhausted: true, cooldownUntil: expect.any(String) });
    expect(after.message).toMatch(/slow down/);
  });
});
