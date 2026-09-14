import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// The route handlers reach the database through getDb(); point it at a private in-memory db so
// these tests never open data/jobseeker.db.
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  const db = actual.openDb(":memory:");
  return { ...actual, getDb: () => db };
});

import { getDb } from "@/lib/db";
import { decodeRequestText, readJsonBody } from "@/lib/request-body";
import { startExecutor, finishRun, runLogLines } from "@/executor/runner";
import { POST as postLog } from "@/app/api/executor/log/route";
import { POST as postFinish } from "@/app/api/executor/finish/route";
import { POST as postReport } from "@/app/api/apply/report/route";

// GBK (Windows code page 936) bytes of the strings below — what Git for Windows' curl.exe puts on
// the wire for an inline `-d '...'` body on the production box (run #68, 2026-09-13).
const LINE = "接单:海投 SWE General 3 份,先核验资格";
const LINE_GBK = "bd d3 b5 a5 3a ba a3 cd b6 20 53 57 45 20 47 65 6e 65 72 61 6c 20 33 20 b7 dd 2c cf c8 ba cb d1 e9 d7 ca b8 f1";
const SUMMARY = "已提交 1 份,跳过 2 个(需人工)";
const SUMMARY_GBK = "d2 d1 cc e1 bd bb 20 31 20 b7 dd 2c cc f8 b9 fd 20 32 20 b8 f6 28 d0 e8 c8 cb b9 a4 29";
const REASON = "登录墙:用户未登录 Workday,需人工";
const REASON_GBK = "b5 c7 c2 bc c7 bd 3a d3 c3 bb a7 ce b4 b5 c7 c2 bc 20 57 6f 72 6b 64 61 79 2c d0 e8 c8 cb b9 a4";

const utf8 = new TextEncoder();
const hex = (s: string) => Uint8Array.from(s.split(" "), (h) => parseInt(h, 16));
// A JSON body whose string value is GBK while everything around it is ASCII — the exact mix curl
// produces, since JSON punctuation is the same bytes in both encodings.
function gbkBody(prefix: string, valueGbk: string, suffix: string): Uint8Array<ArrayBuffer> {
  const parts = [utf8.encode(prefix), hex(valueGbk), utf8.encode(suffix)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
const post = (url: string, body: Uint8Array<ArrayBuffer> | string) =>
  new Request(`http://127.0.0.1:3000${url}`, { method: "POST", headers: { "content-type": "application/json" }, body });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sortie-body-"));

describe("request body decoding", () => {
  it("fixtures really are the GBK encoding of the expected strings", () => {
    const gbk = new TextDecoder("gbk");
    expect(gbk.decode(hex(LINE_GBK))).toBe(LINE);
    expect(gbk.decode(hex(SUMMARY_GBK))).toBe(SUMMARY);
    expect(gbk.decode(hex(REASON_GBK))).toBe(REASON);
  });
  it("keeps valid UTF-8 (ASCII included) untouched and falls back to GBK otherwise", () => {
    expect(decodeRequestText(utf8.encode(LINE))).toBe(LINE);
    expect(decodeRequestText(utf8.encode('{"a":"plain"}'))).toBe('{"a":"plain"}');
    expect(decodeRequestText(hex(LINE_GBK))).toBe(LINE);
  });
  it("readJsonBody parses GBK, UTF-8 and BOM-prefixed bodies alike", async () => {
    await expect(readJsonBody(post("/x", gbkBody('{"line":"', LINE_GBK, '"}')))).resolves.toEqual({ line: LINE });
    await expect(readJsonBody(post("/x", JSON.stringify({ line: LINE })))).resolves.toEqual({ line: LINE });
    await expect(readJsonBody(post("/x", "\ufeff" + JSON.stringify({ line: LINE })))).resolves.toEqual({ line: LINE });
  });
});

describe("session-facing routes accept a GBK body", () => {
  it("POST /api/executor/log stores the original Chinese line", async () => {
    const db = getDb();
    const run = startExecutor(db, "apply", {}, { logDir: tmp() }, "user_chrome");
    const res = await postLog(post("/api/executor/log", gbkBody(`{"runId":${run.id},"line":"`, LINE_GBK, '"}')));
    expect(res.status).toBe(200);
    await postLog(post("/api/executor/log", JSON.stringify({ runId: run.id, line: LINE })));
    const lines = runLogLines(db, run.id).filter(Boolean);
    finishRun(db, run.id, "stopped"); // free the apply slot: startExecutor refuses a second live apply run
    expect(lines).toHaveLength(2);
    for (const l of lines) {
      expect(l.endsWith(` ${LINE}`)).toBe(true);
      expect(l).not.toContain("\ufffd");
    }
  });
  it("POST /api/executor/finish stores the original Chinese summary", async () => {
    const db = getDb();
    const run = startExecutor(db, "apply", {}, { logDir: tmp() }, "user_chrome");
    const body = gbkBody(`{"runId":${run.id},"status":"done","summary":"`, SUMMARY_GBK, '"}');
    expect((await postFinish(post("/api/executor/finish", body))).status).toBe(200);
    const row = db.prepare("SELECT status, summary FROM executor_runs WHERE id=?").get(run.id);
    expect(row).toEqual({ status: "done", summary: SUMMARY });
  });
  it("POST /api/apply/report stores the original Chinese needs_manual reason", async () => {
    const db = getDb();
    const jobId = db
      .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, ats, source) VALUES (?,?,?,?,?,?)")
      .run("fp-gbk", "Acme", "SWE", "https://acme.example/apply", "workday", "manual").lastInsertRowid as number;
    db.prepare("INSERT INTO applications (job_id, status) VALUES (?, 'prepared')").run(jobId);
    const body = gbkBody(`{"jobId":${jobId},"status":"needs_manual","reason":"`, REASON_GBK, '"}');
    expect((await postReport(post("/api/apply/report", body))).status).toBe(200);
    const row = db.prepare("SELECT status, needs_manual_reason FROM applications WHERE job_id=?").get(jobId);
    expect(row).toEqual({ status: "matched", needs_manual_reason: REASON });
  });
});
