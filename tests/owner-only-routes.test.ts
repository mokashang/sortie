import { describe, it, expect, vi } from "vitest";
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
