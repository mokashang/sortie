import { describe, it, expect, vi } from "vitest";
import { setMembersMayUseBackground } from "@/executor/member-policy";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const db = actual.openDb(":memory:");
  return { ...actual, getDb: () => db };
});

import { getDb } from "@/lib/db";
import { createToken } from "@/lib/api-tokens";
import { resetInternalTokenCacheForTests } from "@/lib/internal-token";
import { seedOwner, seedUser } from "./helpers";
import { POST as jdReport } from "@/app/api/jd-review/report/route";
import { GET as jdBatch } from "@/app/api/jd-review/batch/route";
import { POST as scanIngest } from "@/app/api/scan/ingest/route";
import { POST as loginOpen } from "@/app/api/apply/login-open/route";
import { POST as executorStart } from "@/app/api/executor/start/route";
import { POST as applyDecide } from "@/app/api/apply/decide/route";
import { POST as networkDecide } from "@/app/api/network/decide/route";
import { POST as referralDecide } from "@/app/api/referral/decide/route";
import { POST as followupRoute } from "@/app/api/referral/followup/route";
import { POST as autoSubmit } from "@/app/api/settings/auto-submit/route";
import { POST as answerInfo } from "@/app/api/apply/answer-info/route";
import { POST as selfSubmitted } from "@/app/api/apply/self-submitted/route";

// Routes that rewrite shared postings or act on this machine's own Chrome: a second account on
// the same server must not reach them (security review 2026-10-16).
const CTX = { params: Promise.resolve({}) };
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-owner-only-"));
process.env.SORTIE_INTERNAL_TOKEN = "sortie_internal_owneronly_0123456789abcdef";
resetInternalTokenCacheForTests();
const db = getDb();
seedOwner(db, "legacy");
seedUser(db, "m1", "member@example.com", { role: "member" });
const memberToken = createToken(db, { userId: "m1", name: "t" }).token;
const req = (url: string, body?: unknown) =>
  new Request(`http://127.0.0.1:3000${url}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${memberToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("owner-only routes refuse another account", () => {
  it.each([
    ["jd-review report", () => jdReport(req("/api/jd-review/report", { jobId: 1, status: "closed" }), CTX)],
    ["jd-review batch", () => jdBatch(req("/api/jd-review/batch"), CTX)],
    ["scan ingest", () => scanIngest(req("/api/scan/ingest", { jobs: [] }), CTX)],
    ["login-open", () => loginOpen(req("/api/apply/login-open", {}), CTX)],
    ["jd_review start", () => executorStart(req("/api/executor/start", { kind: "jd_review" }), CTX)],
  ])("%s → 403", async (_name, call) => {
    expect((await call()).status).toBe(403);
  });
});

describe("another account starting a task in its own Chrome", () => {
  const plan = { kind: "apply", channel: "user_chrome", options: { plan: [{ direction: "embedded", count: 12, mode: "direct" }] } };
  // (With a resume and the owner's switch on, the task goes to the background browser instead —
  // that path spawns a real agent, so it is covered by tests/executor-channel.test.ts.)
  it("with no resume yet, is told to upload one instead of queueing a task nobody will run", async () => {
    const res = await executorStart(req("/api/executor/start", plan), CTX);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("no_resume");
    expect((db.prepare("SELECT COUNT(*) n FROM executor_runs WHERE user_id = 'm1'").get() as { n: number }).n).toBe(0);
  });

  it("when the owner keeps the background browser to themself, is told no session could take it", async () => {
    setMembersMayUseBackground(db, false);
    try {
      const res = await executorStart(req("/api/executor/start", plan), CTX);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/owner|主账号/);
      expect((db.prepare("SELECT COUNT(*) n FROM executor_runs WHERE user_id = 'm1'").get() as { n: number }).n).toBe(0);
    } finally {
      setMembersMayUseBackground(db, true);
    }
  });

  it("a referral or scan task is refused with the reason", async () => {
    const res = await executorStart(req("/api/executor/start", { kind: "scan", channel: "user_chrome", options: {} }), CTX);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe("attended_unavailable");
  });
});

describe("the user's own decisions never come from a token", () => {
  const asOwnerToken = (url: string, body: unknown) =>
    new Request(`http://127.0.0.1:3000${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SORTIE_INTERNAL_TOKEN}` },
      body: JSON.stringify(body),
    });
  it.each([
    ["approve a fill", () => applyDecide(asOwnerToken("/api/apply/decide", { jobId: 1, decision: "approve" }), CTX)],
    ["approve a networking message", () => networkDecide(asOwnerToken("/api/network/decide", { outreachId: 1, decision: "approve" }), CTX)],
    ["decide a referral card", () => referralDecide(asOwnerToken("/api/referral/decide", { jobIds: [1], action: "direct" }), CTX)],
    ["approve a follow-up", () => followupRoute(asOwnerToken("/api/referral/followup", { followupId: 1, action: "approve" }), CTX)],
    ["switch on auto-apply", () => autoSubmit(asOwnerToken("/api/settings/auto-submit", { enabled: true }), CTX)],
    ["answer a card", () => answerInfo(asOwnerToken("/api/apply/answer-info", { jobId: 1, answers: {} }), CTX)],
    ["say it was submitted", () => selfSubmitted(asOwnerToken("/api/apply/self-submitted", { jobId: 1 }), CTX)],
  ])("%s → 403 browser_only, even with the owner's machine token", async (_name, call) => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("browser_only");
  });
  it("a session may still report a follow-up it sent", async () => {
    const res = await followupRoute(asOwnerToken("/api/referral/followup", { followupId: 999, action: "sent", text: "hi" }), CTX);
    expect(res.status).not.toBe(403);
  });
});
