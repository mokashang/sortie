import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb, type DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { completeGoogleConnect, describeSyncError, disconnectMailbox, inboxStatus, resetInboxCachesForTests, syncAllMailboxes, syncMailbox, syncUserMailboxes, MAX_MESSAGES_PER_SYNC, FETCH_GAP_MS } from "@/inbox/sync";
import { RETRY_DELAYS_MS } from "@/inbox/google";
import { GMAIL_SCOPE } from "@/inbox/scope";
import { getMailAccount, listMailAccounts, upsertMailAccount, recentMailEvents, countMailEvents } from "@/inbox/store";
import type { LlmBackend } from "@/llm/types";

const U = "legacy";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function seedJob(db: DB, company: string, title: string, status = "submitted"): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, company, title, "https://x.example/apply", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (user_id, job_id, direction, score, tier) VALUES (?,?,?,?,?)").run(U, jobId, "swe_general", 80, 1);
  db.prepare("INSERT INTO applications (user_id, job_id, status, submitted_at) VALUES (?,?,?,?)").run(U, jobId, status, "2026-09-02 10:00:00");
  return jobId;
}

function mailbox(db: DB, email = "me@example.com", refreshToken = "rt") {
  return upsertMailAccount(db, { userId: U, email, refreshToken, scope: GMAIL_SCOPE });
}

interface FakeMail {
  id: string;
  from: string;
  subject: string;
  text: string;
  atMs: number;
}

// A Gmail stand-in: the token endpoint, messages.list (honouring the after: seconds in the query)
// and messages.get. Records every URL so the test can assert on the query.
function fakeGmail(mails: FakeMail[], opts: { tokenError?: string; refreshTokens?: Record<string, FakeMail[]> } = {}) {
  const urls: string[] = [];
  let current = mails;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      if (opts.tokenError) return new Response(JSON.stringify({ error: opts.tokenError }), { status: 400 });
      const rt = /refresh_token=([^&]+)/.exec(String(init?.body))?.[1] ?? "";
      if (opts.refreshTokens?.[rt]) current = opts.refreshTokens[rt];
      return new Response(JSON.stringify({ access_token: `at-${rt}`, expires_in: 3600 }), { status: 200 });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
    const u = new URL(url);
    if (u.pathname.endsWith("/messages")) {
      const after = Number(/after:(\d+)/.exec(u.searchParams.get("q") ?? "")?.[1] ?? 0);
      const list = current.filter((m) => Math.floor(m.atMs / 1000) > after).sort((a, b) => b.atMs - a.atMs);
      return new Response(JSON.stringify({ messages: list.map((m) => ({ id: m.id, threadId: `t-${m.id}` })) }), { status: 200 });
    }
    const m = current.find((x) => u.pathname.endsWith(`/messages/${x.id}`));
    if (!m) return new Response("not found", { status: 404 });
    return new Response(
      JSON.stringify({
        id: m.id,
        threadId: `t-${m.id}`,
        snippet: m.text.slice(0, 40),
        internalDate: String(m.atMs),
        payload: { mimeType: "text/plain", headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }], body: { data: b64(m.text) } },
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  return { fetcher, urls };
}

// The model sees per-batch aliases (m1, m2, …), so answers are keyed by alias; `subjects` lets a
// test decide by what the mail says rather than by id.
function fakeBackend(answer: (ids: string[], subjects: string[]) => unknown[]): LlmBackend & { calls: number } {
  const be = {
    name: "fake",
    calls: 0,
    async complete(req: { prompt: string }) {
      be.calls++;
      const blocks = [...req.prompt.matchAll(/<mail id="([^"]+)">\nfrom: [^\n]*\nsubject: ([^\n]*)/g)];
      return { text: JSON.stringify(answer(blocks.map((m) => m[1]), blocks.map((m) => m[2]))), backend: "fake" };
    },
  };
  return be;
}

const T0 = Date.parse("2026-09-20T20:00:00Z");

beforeEach(() => {
  resetInboxCachesForTests();
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "sec";
});

describe("inbox/sync syncMailbox", () => {
  it("reads new mail, pre-filters, classifies, moves stages, notifies and advances the cursor", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    const datadog = seedJob(db, "Datadog", "SWE Intern");
    const stripe = seedJob(db, "Stripe", "SWE New Grad", "oa");
    const box = mailbox(db);

    const { fetcher, urls } = fakeGmail([
      { id: "old", from: "x@greenhouse.io", subject: "Old", text: "before the window", atMs: T0 - 40 * 86400_000 },
      { id: "news", from: "news@substack.com", subject: "This week in Rust", text: "crates", atMs: T0 - 3600_000 },
      { id: "dd", from: "Datadog <no-reply@greenhouse.io>", subject: "Interview with Datadog", text: "We would like to schedule a phone screen.", atMs: T0 - 1800_000 },
      { id: "st", from: "Stripe Recruiting <recruiting@stripe.com>", subject: "Your Stripe application", text: "We will not be moving forward.", atMs: T0 - 600_000 },
    ]);
    const backend = fakeBackend((ids, subjects) =>
      ids.map((id, i) =>
        subjects[i].includes("Datadog")
          ? { message_id: id, job_id: datadog, outcome: "interview", confidence: 0.9, summary: "Phone screen invite", next_step: "Pick a slot" }
          : { message_id: id, job_id: stripe, outcome: "rejected", confidence: 0.85, summary: "Declined", next_step: null }
      )
    );
    const pushes: string[] = [];
    const s = await syncMailbox(db, box, { fetcher, backend, now: () => T0, lang: "en", notifier: (t) => void pushes.push(t), log: () => {} });

    expect(s).toMatchObject({ accountId: box.id, email: "me@example.com", fetched: 3, candidates: 2, matched: 2, applied: 2, notified: 2, error: null, skipped: false });
    expect(backend.calls).toBe(1);
    // the first sync starts at the earliest submission (newer than the 30-day lookback here), minus the overlap
    const listUrl = urls.find((u) => u.includes("/messages?"))!;
    const after = Number(/after%3A(\d+)/.exec(listUrl)![1]);
    expect(after).toBe(Math.floor(Date.parse("2026-09-02T10:00:00Z") / 1000) - 120);
    expect(listUrl).toContain("-in%3Aspam");
    expect(db.prepare("SELECT status FROM applications WHERE job_id = ?").get(datadog)).toEqual({ status: "interview" });
    expect(db.prepare("SELECT status FROM applications WHERE job_id = ?").get(stripe)).toEqual({ status: "rejected" });
    expect(pushes).toEqual(["Sortie · Datadog → Interview", "Sortie · Stripe → Rejected"]);
    const acct = getMailAccount(db, U, box.id)!;
    expect(acct.watermark).toBe(Math.floor((T0 - 600_000) / 1000));
    expect(acct.syncedAt).toBeTruthy();
    expect(acct.lastError).toBeNull();
    expect(recentMailEvents(db, U).map((e) => [e.messageId, e.mailbox])).toEqual([
      ["st", "me@example.com"],
      ["dd", "me@example.com"],
    ]);
    // the newsletter is stored as seen (unrelated, never classified) so it is not fetched again
    expect(inboxStatus(db, U)).toMatchObject({ events: { total: 3, matched: 2, applied: 2 }, mailboxes: [{ id: box.id, email: "me@example.com", events: { total: 3 } }] });
    expect(db.prepare("SELECT outcome, confidence FROM mail_events WHERE message_id = 'news'").get()).toEqual({ outcome: "unrelated", confidence: null });

    // Second pass: nothing new beyond the overlap, the seen ids are skipped, no model call.
    const s2 = await syncMailbox(db, getMailAccount(db, U, box.id)!, { fetcher, backend, now: () => T0 + 60_000, lang: "en", notifier: () => {}, log: () => {} });
    expect(s2).toMatchObject({ fetched: 0, candidates: 0, applied: 0, backlog: 0 });
    expect(backend.calls).toBe(1);
  });

  it("drains a backlog over several passes without moving the cursor past unseen mail, pausing between fetches", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    seedJob(db, "Datadog", "SWE Intern");
    const box = mailbox(db);
    const many: FakeMail[] = Array.from({ length: MAX_MESSAGES_PER_SYNC + 5 }, (_, i) => ({ id: `m${i}`, from: "x@example.com", subject: `Newsletter ${i}`, text: "noise", atMs: T0 - (i + 1) * 60_000 }));
    const { fetcher } = fakeGmail(many);
    const sleeps: number[] = [];
    const deps = { fetcher, backend: fakeBackend(() => []), now: () => T0, log: () => {}, sleep: async (ms: number) => void sleeps.push(ms) };
    const first = await syncMailbox(db, box, deps);
    expect(first).toMatchObject({ fetched: MAX_MESSAGES_PER_SYNC, backlog: 5, error: null });
    expect(sleeps.filter((ms) => ms === FETCH_GAP_MS)).toHaveLength(MAX_MESSAGES_PER_SYNC - 1);
    // the cursor did not move: the five oldest are still unseen
    const start = Math.floor(Date.parse("2026-09-02T10:00:00Z") / 1000);
    expect(getMailAccount(db, U, box.id)!.watermark).toBe(start);
    const second = await syncMailbox(db, getMailAccount(db, U, box.id)!, deps);
    expect(second).toMatchObject({ fetched: 5, backlog: 0 });
    expect(getMailAccount(db, U, box.id)!.watermark).toBe(Math.floor((T0 - 60_000) / 1000));
    expect(countMailEvents(db, U).total).toBe(MAX_MESSAGES_PER_SYNC + 5);
  });

  it("retries a rate-limited fetch with backoff instead of failing the pass", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    seedJob(db, "Datadog", "SWE Intern");
    const box = mailbox(db);
    const { fetcher: inner } = fakeGmail([{ id: "a", from: "x@greenhouse.io", subject: "Interview", text: "hi", atMs: T0 - 1000 }]);
    let denials = 2;
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("/messages/a") && denials-- > 0) {
        return new Response(JSON.stringify({ error: { code: 403, message: "Quota exceeded for quota metric 'Total Query Cost'", errors: [{ reason: "rateLimitExceeded" }] } }), { status: 403 });
      }
      return inner(input, init);
    }) as typeof fetch;
    const sleeps: number[] = [];
    const s = await syncMailbox(db, box, { fetcher, backend: fakeBackend((ids) => ids.map((id) => ({ message_id: id, job_id: null, outcome: "unrelated", confidence: 0.9, summary: "", next_step: null }))), now: () => T0, log: () => {}, sleep: async (ms) => void sleeps.push(ms) });
    expect(s).toMatchObject({ fetched: 1, candidates: 1, error: null });
    expect(sleeps).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]]);
  });

  it("keeps two mailboxes apart: each has its own token, cursor and seen-message set", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    const job = seedJob(db, "Datadog", "SWE Intern");
    const a = mailbox(db, "a@example.com", "rt-a");
    const b = mailbox(db, "b@example.com", "rt-b");
    const shared = { id: "same-id", from: "Datadog <no-reply@greenhouse.io>", subject: "Datadog update", text: "status", atMs: T0 - 1000 };
    const { fetcher } = fakeGmail([], { refreshTokens: { "rt-a": [shared], "rt-b": [{ ...shared, subject: "Datadog interview" }] } });
    const backend = fakeBackend((ids) => ids.map((id) => ({ message_id: id, job_id: job, outcome: "received", confidence: 0.9, summary: "ack", next_step: null })));
    const out = await syncUserMailboxes(db, U, { fetcher, backend, now: () => T0, log: () => {} });
    expect(out.map((s) => [s.email, s.fetched, s.matched, s.error])).toEqual([
      ["a@example.com", 1, 1, null],
      ["b@example.com", 1, 1, null],
    ]);
    expect(countMailEvents(db, U)).toEqual({ total: 2, matched: 2, applied: 0 });
    expect(countMailEvents(db, U, a.id).total).toBe(1);
    expect(countMailEvents(db, U, b.id).total).toBe(1);
    expect(getMailAccount(db, U, a.id)!.watermark).toBe(Math.floor((T0 - 1000) / 1000));
    // one mailbox only
    const only = await syncUserMailboxes(db, U, { fetcher, backend, now: () => T0 + 60_000, accountId: b.id, log: () => {} });
    expect(only.map((s) => s.email)).toEqual(["b@example.com"]);
    expect(await syncUserMailboxes(db, "someone-else", { fetcher, backend, accountId: a.id, log: () => {} })).toEqual([]);
  });

  it("with nothing submitted yet only advances the cursor", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    const box = mailbox(db);
    const { fetcher } = fakeGmail([{ id: "a", from: "x@greenhouse.io", subject: "Interview", text: "hi", atMs: T0 - 1000 }]);
    const backend = fakeBackend(() => []);
    const s = await syncMailbox(db, box, { fetcher, backend, now: () => T0, log: () => {} });
    expect(s).toMatchObject({ fetched: 1, candidates: 0, skipped: true, error: null });
    expect(backend.calls).toBe(0);
    expect(getMailAccount(db, U, box.id)!.watermark).toBe(Math.floor((T0 - 1000) / 1000));
  });

  it("records a revoked grant as an error the settings page can show, and does not throw", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    seedJob(db, "Datadog", "SWE");
    const box = mailbox(db);
    const { fetcher } = fakeGmail([], { tokenError: "invalid_grant" });
    const s = await syncMailbox(db, box, { fetcher, backend: fakeBackend(() => []), now: () => T0, log: () => {} });
    expect(s.error).toMatch(/^reconnect needed/);
    expect(getMailAccount(db, U, box.id)!.lastError).toMatch(/^reconnect needed/);
  });

  it("turns Google's 'API not enabled' 403 into one sentence with the enable link", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    seedJob(db, "Datadog", "SWE");
    const box = mailbox(db);
    const body = {
      error: {
        code: 403,
        message:
          "Gmail API has not been used in project 1070513376946 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=1070513376946 then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.",
        status: "PERMISSION_DENIED",
      },
    };
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify(body, null, 2), { status: 403 });
    }) as typeof fetch;
    const s = await syncMailbox(db, box, { fetcher, backend: fakeBackend(() => []), now: () => T0, log: () => {} });
    expect(s.error).toBe(
      "Gmail API is not enabled on the Google Cloud project — enable it at https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=1070513376946, then sync again"
    );
    expect(getMailAccount(db, U, box.id)!.lastError).toBe(s.error);
    expect(describeSyncError(new Error("boom"))).toBe("boom");
  });

  it("syncAllMailboxes with dueOnly skips a mailbox synced a moment ago", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    mailbox(db);
    const { fetcher, urls } = fakeGmail([]);
    const first = await syncAllMailboxes(db, { fetcher, backend: fakeBackend(() => []), now: () => Date.now(), dueOnly: true, log: () => {} });
    expect(first).toHaveLength(1);
    const listed = urls.filter((u) => u.includes("/messages?")).length;
    const second = await syncAllMailboxes(db, { fetcher, backend: fakeBackend(() => []), now: () => Date.now(), dueOnly: true, log: () => {} });
    expect(second).toHaveLength(0);
    expect(urls.filter((u) => u.includes("/messages?")).length).toBe(listed);
  });
});

describe("inbox/sync connect / disconnect", () => {
  const idToken = (email: string) => `h.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.s`;

  it("completeGoogleConnect stores one row per (account, address) and reconnecting keeps the cursor", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    const grant = (email: string, rt: string) => (async () => new Response(JSON.stringify({ refresh_token: rt, scope: `openid email ${GMAIL_SCOPE}`, id_token: idToken(email) }), { status: 200 })) as typeof fetch;
    const a = await completeGoogleConnect(db, U, "code-a", { redirectUri: "https://x/cb", fetcher: grant("A@Example.com", "rt-a") });
    const b = await completeGoogleConnect(db, U, "code-b", { redirectUri: "https://x/cb", fetcher: grant("b@example.com", "rt-b") });
    expect(listMailAccounts(db, U).map((r) => [r.email, r.refreshToken])).toEqual([
      ["a@example.com", "rt-a"],
      ["b@example.com", "rt-b"],
    ]);
    db.prepare("UPDATE mail_accounts SET watermark = 123, last_error = 'x' WHERE id = ?").run(a.id);
    const again = await completeGoogleConnect(db, U, "code-a2", { redirectUri: "https://x/cb", fetcher: grant("a@example.com", "rt-a2") });
    expect(again.id).toBe(a.id);
    expect(getMailAccount(db, U, a.id)).toMatchObject({ refreshToken: "rt-a2", watermark: 123, lastError: null });
    expect(b.id).not.toBe(a.id);
    await expect(completeGoogleConnect(db, U, "c", { redirectUri: "https://x/cb", fetcher: (async () => new Response(JSON.stringify({ refresh_token: "r", scope: "openid", id_token: idToken("z@z.z") }), { status: 200 })) as typeof fetch })).rejects.toMatchObject({ code: "no_scope" });
  });

  it("disconnect removes just that mailbox and revokes its grant, keeping the recorded events", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    const a = mailbox(db, "a@example.com", "rt-a");
    const b = mailbox(db, "b@example.com", "rt-b");
    const { fetcher, urls } = fakeGmail([]);
    expect(await disconnectMailbox(db, U, a.id, { fetcher })).toBe(true);
    expect(listMailAccounts(db, U).map((r) => r.id)).toEqual([b.id]);
    expect(urls.some((u) => u.startsWith("https://oauth2.googleapis.com/revoke?token=rt-a"))).toBe(true);
    expect(await disconnectMailbox(db, U, a.id, { fetcher })).toBe(false);
    expect(await disconnectMailbox(db, "someone-else", b.id, { fetcher })).toBe(false);
    expect(inboxStatus(db, U).mailboxes.map((m) => m.email)).toEqual(["b@example.com"]);
  });
});

describe("inbox/sync v17 -> v18 migration", () => {
  it("rebuilds the single-mailbox tables, keeping the connected row", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-v17-"));
    const file = path.join(dir, "t.db");
    const raw = openDb(file);
    // Turn a fresh v18 db into the v17 shape: mail_accounts keyed by user_id, mail_events without account_id.
    raw.exec(`
      DROP TABLE mail_events; DROP TABLE mail_accounts;
      CREATE TABLE mail_accounts (user_id TEXT PRIMARY KEY, provider TEXT NOT NULL DEFAULT 'google', email TEXT, refresh_token TEXT NOT NULL, scope TEXT,
        connected_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT, watermark INTEGER, last_error TEXT, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE mail_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, message_id TEXT NOT NULL, thread_id TEXT, received_at TEXT NOT NULL,
        from_addr TEXT, subject TEXT, snippet TEXT, job_id INTEGER, outcome TEXT NOT NULL, confidence REAL, summary TEXT, next_step TEXT,
        applied INTEGER NOT NULL DEFAULT 0, stage_from TEXT, stage_to TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (user_id, message_id));
      INSERT INTO mail_accounts (user_id, email, refresh_token, scope, watermark, last_error) VALUES ('legacy', 'me@example.com', 'rt', 'gmail', 42, 'old error');
    `);
    raw.pragma("user_version = 17");
    raw.close();

    const db = openDb(file);
    expect(db.pragma("user_version", { simple: true })).toBe(18);
    const cols = (db.prepare("PRAGMA table_info(mail_accounts)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain("id");
    expect((db.prepare("PRAGMA table_info(mail_events)").all() as { name: string }[]).map((c) => c.name)).toContain("account_id");
    expect(listMailAccounts(db, "legacy")).toMatchObject([{ email: "me@example.com", refreshToken: "rt", watermark: 42, lastError: "old error" }]);
    expect(() => upsertMailAccount(db, { userId: "legacy", email: "two@example.com", refreshToken: "r2", scope: null })).not.toThrow();
    expect(listMailAccounts(db, "legacy")).toHaveLength(2);
    db.close();
    // re-opening is a no-op
    const again = new Database(file);
    expect(again.pragma("user_version", { simple: true })).toBe(18);
    again.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
