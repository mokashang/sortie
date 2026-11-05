import { describe, it, expect, vi } from "vitest";
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
import { GET as getPendingRoute } from "@/app/api/apply/pending/route";
import { POST as postUnparkRoute } from "@/app/api/apply/unpark/route";
import { POST as postRetrySubmitRoute } from "@/app/api/apply/retry-submit/route";
import { needsOpenTab } from "@/apply/info";
import { InfoQuestion } from "@/apply/queue";
import { resetInternalTokenCacheForTests } from "@/lib/internal-token";
import { seedOwner } from "./helpers";

const CTX = { params: Promise.resolve({}) };
const U = "legacy";
const TOKEN = "sortie_internal_tabs_0123456789abcdef0";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-tab-closed-"));
process.env.SORTIE_INTERNAL_TOKEN = TOKEN;
resetInternalTokenCacheForTests();
seedOwner(getDb(), U);

const auth = { authorization: `Bearer ${TOKEN}` };
const post = (url: string, body: unknown) =>
  new Request(`http://127.0.0.1:3000${url}`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify(body) });

const action: InfoQuestion = { kind: "action", key: "arbitration_ack", label: "在打开的申请页里勾选仲裁协议" };
const text: InfoQuestion = { key: "high_school", label: "High school" };
const login: InfoQuestion = { kind: "login", key: "login", label: "Log in", host: "jobs.example" };

let n = 0;
function card(questions: InfoQuestion[], fields: { status?: string; reason?: string; runId?: number | null } = {}): number {
  const db = getDb();
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-tab-${++n}`, "Acme", "SWE", "https://acme.example/apply", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO applications (job_id, status, pending_questions, needs_manual_reason, run_id) VALUES (?,?,?,?,?)").run(
    jobId,
    fields.status ?? "needs_info",
    JSON.stringify(questions),
    fields.reason ?? null,
    fields.runId ?? null
  );
  return jobId;
}

async function cards(): Promise<{ jobId: number; tabOpen?: boolean }[]> {
  const res = await getPendingRoute(new Request("http://127.0.0.1:3000/api/apply/pending", { headers: auth }), CTX);
  return (await res.json()).needsInfo;
}

describe("needsOpenTab", () => {
  it("is for steps done in the tab, not for answers or items that closed their tab", () => {
    expect(needsOpenTab([action])).toBe(true);
    expect(needsOpenTab([{ kind: "submit", key: "submit", label: "Submit" }])).toBe(true);
    expect(needsOpenTab([action, text])).toBe(true);
    expect(needsOpenTab([text])).toBe(false);
    expect(needsOpenTab([{ kind: "file", key: "transcript", label: "Transcript" }])).toBe(false);
    expect(needsOpenTab([login])).toBe(false);
    expect(needsOpenTab([action, login])).toBe(false);
  });
});

describe("GET /api/apply/pending tabOpen", () => {
  it("an action card detached from its session says the tab is gone", async () => {
    const jobId = card([action]);
    expect((await cards()).find((c) => c.jobId === jobId)?.tabOpen).toBe(false);
  });

  it("a run still running on the form keeps the tab open", async () => {
    const db = getDb();
    const runId = db.prepare("INSERT INTO executor_runs (kind, status, channel) VALUES ('apply', 'running', 'user_chrome')").run().lastInsertRowid as number;
    const jobId = card([action], { runId });
    expect((await cards()).find((c) => c.jobId === jobId)?.tabOpen).toBe(true);
  });

  it("a 「点提交」 card nobody holds says so too; a question or a login card doesn't carry it", async () => {
    const submit = card([{ kind: "submit", key: "submit", label: "Submit" }], { status: "matched", reason: "submit blocked: refused" });
    const question = card([text]);
    const wall = card([login], { status: "matched", reason: "login" });
    const list = await cards();
    expect(list.find((c) => c.jobId === submit)?.tabOpen).toBe(false);
    expect(list.find((c) => c.jobId === question)).not.toHaveProperty("tabOpen");
    expect(list.find((c) => c.jobId === wall)).not.toHaveProperty("tabOpen");
  });
});

describe("重新打开", () => {
  it("an action card goes back to the assistant as a targeted run, without pretending the step was done", async () => {
    const db = getDb();
    const jobId = card([action]);
    const res = await postUnparkRoute(post("/api/apply/unpark", { jobId, note: "勾之前先等我" }), CTX);
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT status, pending_questions, info_answers FROM applications WHERE job_id = ?").get(jobId) as {
      status: string;
      pending_questions: string | null;
      info_answers: string;
    };
    expect(row).toMatchObject({ status: "matched", pending_questions: null });
    expect(JSON.parse(row.info_answers)).not.toHaveProperty(action.key);
    const queued = db.prepare("SELECT options FROM executor_runs WHERE status = 'queued' ORDER BY id DESC LIMIT 1").get() as { options: string };
    expect(JSON.parse(queued.options).jobIds).toContain(jobId);
    expect((await cards()).some((c) => c.jobId === jobId)).toBe(false);
  });

  it("a 「点提交」 card with nobody on the tab is filled afresh", async () => {
    const db = getDb();
    const jobId = card([{ kind: "submit", key: "submit", label: "Submit" }], { status: "matched", reason: "submit blocked: refused" });
    const res = await postRetrySubmitRoute(post("/api/apply/retry-submit", { jobId }), CTX);
    expect(await res.json()).toMatchObject({ ok: true, notified: false });
    expect(db.prepare("SELECT status, needs_manual_reason, pending_questions FROM applications WHERE job_id = ?").get(jobId)).toEqual({
      status: "matched",
      needs_manual_reason: null,
      pending_questions: null,
    });
  });
});
