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
import { POST as postReportRoute } from "@/app/api/apply/report/route";
import { POST as postRetryRoute } from "@/app/api/apply/retry-submit/route";
import { resetInternalTokenCacheForTests } from "@/lib/internal-token";
import { resetSubmitPushThrottle } from "@/apply/submit-blocked";
import { seedOwner } from "./helpers";

const CTX = { params: Promise.resolve({}) };
const U = "legacy";
const TOKEN = "sortie_internal_submit_0123456789abcdef";
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-submit-data-"));
process.env.SORTIE_INTERNAL_TOKEN = TOKEN;
resetInternalTokenCacheForTests();
seedOwner(getDb(), U);

const post = (url: string, body: unknown) =>
  new Request(`http://127.0.0.1:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });

describe("POST /api/apply/report {status:'submit_blocked'} and /api/apply/retry-submit", () => {
  it("parks an approved fill as a 「点提交」 card and answers card:'submit'", async () => {
    resetSubmitPushThrottle();
    const db = getDb();
    const jobId = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
      .run("fp-sbr-1", "Perpay", "SWE", "https://perpay.example/apply", "manual").lastInsertRowid as number;
    db.prepare("INSERT INTO applications (job_id, status, confirm_decision) VALUES (?, 'awaiting_confirm', 'approved')").run(jobId);
    const res = await postReportRoute(post("/api/apply/report", { jobId, status: "submit_blocked", reason: "classifier refused Submit" }), CTX);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, card: "submit" });
    expect(db.prepare("SELECT status, confirm_decision FROM applications WHERE job_id = ?").get(jobId)).toEqual({ status: "matched", confirm_decision: "approved" });
  });

  it("retry-submit refuses a bad id and a job that is not waiting on a Submit click", async () => {
    expect((await postRetryRoute(post("/api/apply/retry-submit", { jobId: "x" }), CTX)).status).toBe(400);
    const db = getDb();
    const jobId = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
      .run("fp-sbr-2", "Acme", "SWE", "https://acme.example/apply", "manual").lastInsertRowid as number;
    db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'matched')").run(jobId);
    const res = await postRetryRoute(post("/api/apply/retry-submit", { jobId }), CTX);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
