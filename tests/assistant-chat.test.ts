import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { buildSnapshot, mentionedRunIds } from "@/assistant/context";
import { answerChat, buildChatRequest, normalizeMessages, ChatInputError, MAX_MESSAGES } from "@/assistant/chat";
import { chatBackend, getChatProvider, setChatProvider } from "@/assistant/provider";
import { registerBackend } from "@/llm/registry";
import { setAiProvider } from "@/ai/config";
import type { LlmBackend, LlmRequest } from "@/llm/types";

// Rows seeded without a user land in the schema's default bucket; these tests act as its owner.
const U = "legacy";

function seedJob(db: DB, status: string, extra: Partial<{ confirm_decision: string; pending_questions: string; filled_fields: string; company: string; title: string }> = {}): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, source, apply_url) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, extra.company ?? "Acme", extra.title ?? "SWE New Grad", "manual", "https://acme.example/apply").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (job_id, direction, score, tier) VALUES (?,?,?,?)").run(jobId, "swe_general", 82, 1);
  db.prepare("INSERT INTO applications (job_id, status, confirm_decision, pending_questions, filled_fields) VALUES (?,?,?,?,?)").run(
    jobId,
    status,
    extra.confirm_decision ?? null,
    extra.pending_questions ?? null,
    extra.filled_fields ?? null
  );
  return jobId;
}

function seedRun(db: DB, fields: { kind?: string; status: string; options?: object; summary?: string; outcome?: object; log?: string[] }): number {
  let logPath: string | null = null;
  if (fields.log) {
    logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sortie-chat-")), "run.log");
    fs.writeFileSync(logPath, fields.log.join("\n") + "\n");
  }
  return db
    .prepare("INSERT INTO executor_runs (kind, status, channel, options, summary, outcome, log_path, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(
      fields.kind ?? "apply",
      fields.status,
      "user_chrome",
      JSON.stringify(fields.options ?? {}),
      fields.summary ?? null,
      fields.outcome ? JSON.stringify(fields.outcome) : null,
      logPath,
      "2026-09-18 10:00:00",
      fields.status === "running" || fields.status === "queued" ? null : "2026-09-18 10:30:00"
    ).lastInsertRowid as number;
}

describe("mentionedRunIds", () => {
  it("finds task numbers in Chinese and English phrasings", () => {
    expect(mentionedRunIds("任务 #118 为什么没完成?")).toEqual([118]);
    expect(mentionedRunIds("任务118 和 task 120 还有 run #7")).toEqual([118, 120, 7]);
    expect(mentionedRunIds("What happened to #71?")).toEqual([71]);
  });
  it("ignores plain numbers and caps at three", () => {
    expect(mentionedRunIds("I applied to 5 jobs in 2026")).toEqual([]);
    expect(mentionedRunIds("#1 #2 #3 #4")).toEqual([1, 2, 3]);
  });
});

describe("buildSnapshot", () => {
  it("lists tasks, cards and numbers from the account's own rows", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    seedJob(db, "awaiting_confirm", { company: "Stripe", title: "SWE New Grad", filled_fields: '{"name":"M"}' });
    seedJob(db, "awaiting_confirm", { company: "Datadog", title: "SWE Intern", confirm_decision: "approved" });
    seedJob(db, "needs_info", {
      company: "Palantir",
      title: "FDSE",
      pending_questions: JSON.stringify([{ key: "transcript", kind: "file", label: "Upload transcript" }]),
    });
    seedJob(db, "matched", { company: "Nvidia", title: "GPU SWE" });
    seedRun(db, {
      status: "done",
      options: { plan: [{ direction: "swe_general", count: 70 }], chunk: 10 },
      summary: "filled 5, then the tab group was lost",
      outcome: { planned: { direct: 70, referral: 0 }, achieved: { direct: 5, referral: 0 }, own: { direct: 5, referral: 0 }, submitted: 2, awaiting: 3, manual: 0, archived: 1, info: 0, complete: false },
    });
    seedRun(db, { status: "running", options: { resume: true }, log: ["[10:01:00] claimed task", "[10:02:00] opened Stripe form"] });

    const snap = buildSnapshot(db, U, "zh", "助手在干嘛", { now: () => Date.parse("2026-09-18T11:00:00Z") });
    expect(snap).toContain("## Tasks");
    expect(snap).toContain("task #1");
    expect(snap).toContain("未完成");
    expect(snap).toContain("海投 5/70");
    expect(snap).toContain("filled 5, then the tab group was lost");
    expect(snap).toContain("task #2");
    expect(snap).toContain("opened Stripe form");
    expect(snap).toContain("Stripe — SWE New Grad");
    expect(snap).toContain("Datadog — SWE Intern");
    expect(snap).toMatch(/approved, waiting for the assistant to submit/);
    expect(snap).toContain("Palantir — FDSE");
    expect(snap).toContain("file: Upload transcript");
    expect(snap).toMatch(/to confirm: 2/);
    expect(snap).toMatch(/to-do cards: 1/);
    expect(snap).toMatch(/queue \(ready to apply, all tracks\): 1/);
    expect(snap).toContain("Nvidia GPU SWE");
    expect(snap).toContain("auto-apply: off");
  });

  it("adds the full log of a task the question names, even outside the last ten", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    const first = seedRun(db, { status: "failed", log: ["[09:00:00] claimed", "[09:05:00] login wall at Apple", "[09:06:00] reported needs_info"] });
    for (let i = 0; i < 11; i++) seedRun(db, { status: "done" });
    const snapWithout = buildSnapshot(db, U, "en", "what is going on?");
    expect(snapWithout).not.toContain("login wall at Apple");
    const snap = buildSnapshot(db, U, "en", `why did task #${first} fail?`);
    expect(snap).toContain("## Tasks the question names");
    expect(snap).toContain(`log of task #${first}`);
    expect(snap).toContain("login wall at Apple");
    expect(buildSnapshot(db, U, "en", "and #999?")).toContain("task #999: not found in this account");
  });

  it("keeps the newest apply task visible when background rounds push it out of the last ten", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    const apply = seedRun(db, { status: "done", summary: "filled 3 of 10" });
    for (let i = 0; i < 12; i++) seedRun(db, { kind: "jd_review", status: "done" });
    const snap = buildSnapshot(db, U, "en", "how did the last apply task go?");
    expect(snap).toContain("## Latest task of each kind not in the list above");
    expect(snap).toContain(`task #${apply}`);
    expect(snap).toContain("filled 3 of 10");
  });

  it("does not show another account's tasks", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    db.prepare('INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role) VALUES (?,?,?,?,?,?,?)').run(
      "other", "Other", "other@example.com", 0, "2026-09-01", "2026-09-01", "member"
    );
    db.prepare("INSERT INTO executor_runs (user_id, kind, status, channel, options, started_at) VALUES (?,?,?,?,?,?)").run(
      "other", "apply", "running", "user_chrome", "{}", "2026-09-18 10:00:00"
    );
    const snap = buildSnapshot(db, U, "en", "task #1?");
    expect(snap).toContain("no tasks have run yet");
    expect(snap).toContain("task #1: not found in this account");
  });
});

describe("normalizeMessages", () => {
  it("accepts a user-terminated list and drops old turns", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", content: `m${i}` }));
    many.push({ role: "user", content: "last" });
    const out = normalizeMessages(many);
    expect(out.length).toBe(MAX_MESSAGES);
    expect(out[out.length - 1]).toEqual({ role: "user", content: "last" });
  });
  it("rejects empty, malformed, over-long and assistant-terminated input", () => {
    expect(() => normalizeMessages([])).toThrow(ChatInputError);
    expect(() => normalizeMessages("hi")).toThrow(ChatInputError);
    expect(() => normalizeMessages([{ role: "system", content: "x" }])).toThrow(ChatInputError);
    expect(() => normalizeMessages([{ role: "user", content: "x".repeat(5000) }])).toThrow(/longer than/);
    expect(() => normalizeMessages([{ role: "user", content: "q" }, { role: "assistant", content: "a" }])).toThrow(/last message/);
    expect(() => normalizeMessages([{ role: "user", content: "   " }])).toThrow(ChatInputError);
  });
});

describe("buildChatRequest", () => {
  it("is a bare smart-tier request carrying the guide, the snapshot, the transcript and the language", () => {
    const req = buildChatRequest({
      snapshot: "## Tasks\n- task #5 …",
      lang: "zh",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "task #5?" },
      ],
    });
    expect(req.bare).toBe(true);
    expect(req.tier).toBe("smart");
    expect(req.system).toContain("exactly four things through TOOLS");
    expect(req.system).toContain("ACTION: {");
    expect(req.system).toContain("# Sortie");
    expect(req.system).toContain("待确认 To confirm");
    expect(req.prompt).toContain("task #5 …");
    expect(req.prompt).toContain("User: hi");
    expect(req.prompt).toContain("Assistant: hello");
    expect(req.prompt).toMatch(/THE USER'S NEW MESSAGE\n\ntask #5\?/);
    expect(req.prompt).toContain("Simplified Chinese");
    expect(buildChatRequest({ snapshot: "", lang: "en", messages: [{ role: "user", content: "x" }] }).prompt).toContain("in English");
  });
});

describe("answerChat", () => {
  it("streams through a backend that can stream", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    const seen: LlmRequest[] = [];
    const be: LlmBackend = {
      name: "fake",
      complete: async () => {
        throw new Error("should not be used");
      },
      stream: async (req, onDelta) => {
        seen.push(req);
        onDelta("Hel");
        onDelta("lo");
        return { text: "Hello", backend: "fake" };
      },
    };
    const deltas: string[] = [];
    const r = await answerChat(db, U, "en", [{ role: "user", content: "what is the assistant doing?" }], { backend: be, onDelta: (t) => deltas.push(t) });
    expect(r.text).toBe("Hello");
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(seen[0].prompt).toContain("## Tasks");
    expect(seen[0].bare).toBe(true);
  });

  it("falls back to complete() and delivers the whole text as one delta", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    const be: LlmBackend = { name: "plain", complete: async () => ({ text: "Idle.", backend: "plain" }) };
    const deltas: string[] = [];
    const r = await answerChat(db, U, "zh", [{ role: "user", content: "?" }], { backend: be, onDelta: (t) => deltas.push(t) });
    expect(r.text).toBe("Idle.");
    expect(deltas).toEqual(["Idle."]);
  });
});

describe("chat provider setting", () => {
  it("defaults to the Claude subscription and can follow the global provider", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    expect(getChatProvider(db, U)).toBe("claude");
    expect(chatBackend(db, U).name).toBe("subscription");
    const fake: LlmBackend = { name: "codex", complete: async () => ({ text: "", backend: "codex" }) };
    registerBackend(fake);
    setAiProvider(db, "codex");
    // still Claude while the chat setting says so …
    expect(chatBackend(db, U).name).toBe("subscription");
    setChatProvider(db, U, "follow");
    expect(getChatProvider(db, U)).toBe("follow");
    // … and the global choice is only honoured through getBackend() reading this db
  });
  it("is per account", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    setChatProvider(db, U, "follow");
    expect(getChatProvider(db, "someone-else")).toBe("claude");
  });
});
