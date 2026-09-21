import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { connectFromGoogleAccount, disconnectMailbox, inboxStatus, resetInboxCachesForTests, syncAllMailboxes, syncMailbox, InboxConnectError } from "@/inbox/sync";
import { GMAIL_SCOPE } from "@/inbox/scope";
import { getMailAccount, upsertMailAccount, recentMailEvents } from "@/inbox/store";
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

interface FakeMail {
  id: string;
  from: string;
  subject: string;
  text: string;
  atMs: number;
}

// A Gmail stand-in: the token endpoint, messages.list (honouring the after: seconds in the query)
// and messages.get. Records every URL so the test can assert on the query.
function fakeGmail(mails: FakeMail[], opts: { tokenError?: string } = {}) {
  const urls: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      if (opts.tokenError) return new Response(JSON.stringify({ error: opts.tokenError }), { status: 400 });
      return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
    }
    if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
    const u = new URL(url);
    if (u.pathname.endsWith("/messages")) {
      const after = Number(/after:(\d+)/.exec(u.searchParams.get("q") ?? "")?.[1] ?? 0);
      const list = mails.filter((m) => Math.floor(m.atMs / 1000) > after).sort((a, b) => b.atMs - a.atMs);
      return new Response(JSON.stringify({ messages: list.map((m) => ({ id: m.id, threadId: `t-${m.id}` })) }), { status: 200 });
    }
    const m = mails.find((x) => u.pathname.endsWith(`/messages/${x.id}`));
    if (!m) return new Response("not found", { status: 404 });
    expect(init?.headers).toMatchObject({ authorization: "Bearer at" });
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

function fakeBackend(answer: (ids: string[]) => unknown[]): LlmBackend & { calls: number } {
  const be = {
    name: "fake",
    calls: 0,
    async complete(req: { prompt: string }) {
      be.calls++;
      const ids = [...req.prompt.matchAll(/<mail id="([^"]+)">/g)].map((m) => m[1]);
      return { text: JSON.stringify(answer(ids)), backend: "fake" };
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
    upsertMailAccount(db, { userId: U, email: "me@example.com", refreshToken: "rt", scope: GMAIL_SCOPE });

    const { fetcher, urls } = fakeGmail([
      { id: "old", from: "x@greenhouse.io", subject: "Old", text: "before the window", atMs: T0 - 40 * 86400_000 },
      { id: "news", from: "news@substack.com", subject: "This week in Rust", text: "crates", atMs: T0 - 3600_000 },
      { id: "dd", from: "Datadog <no-reply@greenhouse.io>", subject: "Interview with Datadog", text: "We would like to schedule a phone screen.", atMs: T0 - 1800_000 },
      { id: "st", from: "Stripe Recruiting <recruiting@stripe.com>", subject: "Your Stripe application", text: "We will not be moving forward.", atMs: T0 - 600_000 },
    ]);
    const backend = fakeBackend((ids) =>
      ids.map((id) =>
        id === "dd"
          ? { message_id: id, job_id: datadog, outcome: "interview", confidence: 0.9, summary: "Phone screen invite", next_step: "Pick a slot" }
          : { message_id: id, job_id: stripe, outcome: "rejected", confidence: 0.85, summary: "Declined", next_step: null }
      )
    );
    const pushes: string[] = [];
    const s = await syncMailbox(db, U, { fetcher, backend, now: () => T0, lang: "en", notifier: (t) => void pushes.push(t), log: () => {} });

    expect(s).toMatchObject({ fetched: 3, candidates: 2, matched: 2, applied: 2, notified: 2, error: null, skipped: false });
    expect(backend.calls).toBe(1);
    // the first sync starts at the earliest submission (newer than the 30-day lookback here), minus the overlap
    const listUrl = urls.find((u) => u.includes("/messages?"))!;
    const after = Number(/after%3A(\d+)/.exec(listUrl)![1]);
    expect(after).toBe(Math.floor(Date.parse("2026-09-02T10:00:00Z") / 1000) - 120);
    expect(listUrl).toContain("-in%3Aspam");
    expect(db.prepare("SELECT status FROM applications WHERE job_id = ?").get(datadog)).toEqual({ status: "interview" });
    expect(db.prepare("SELECT status FROM applications WHERE job_id = ?").get(stripe)).toEqual({ status: "rejected" });
    expect(pushes).toEqual(["Sortie · Datadog → Interview", "Sortie · Stripe → Rejected"]);
    const acct = getMailAccount(db, U)!;
    expect(acct.watermark).toBe(Math.floor((T0 - 600_000) / 1000));
    expect(acct.syncedAt).toBeTruthy();
    expect(acct.lastError).toBeNull();
    expect(recentMailEvents(db, U).map((e) => e.messageId)).toEqual(["st", "dd"]);
    expect(inboxStatus(db, U)).toMatchObject({ connected: true, email: "me@example.com", events: { total: 2, matched: 2, applied: 2 } });

    // Second pass: nothing new beyond the overlap, the seen ids are skipped, no model call.
    const s2 = await syncMailbox(db, U, { fetcher, backend, now: () => T0 + 60_000, lang: "en", notifier: () => {}, log: () => {} });
    expect(s2).toMatchObject({ fetched: 0, candidates: 0, applied: 0 });
    expect(backend.calls).toBe(1);
  });

  it("with nothing submitted yet only advances the cursor", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    upsertMailAccount(db, { userId: U, email: null, refreshToken: "rt", scope: GMAIL_SCOPE });
    const { fetcher } = fakeGmail([{ id: "a", from: "x@greenhouse.io", subject: "Interview", text: "hi", atMs: T0 - 1000 }]);
    const backend = fakeBackend(() => []);
    const s = await syncMailbox(db, U, { fetcher, backend, now: () => T0, log: () => {} });
    expect(s).toMatchObject({ fetched: 1, candidates: 0, skipped: true, error: null });
    expect(backend.calls).toBe(0);
    expect(getMailAccount(db, U)!.watermark).toBe(Math.floor((T0 - 1000) / 1000));
  });

  it("records a revoked grant as an error the settings page can show, and does not throw", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    seedJob(db, "Datadog", "SWE");
    upsertMailAccount(db, { userId: U, email: null, refreshToken: "rt", scope: GMAIL_SCOPE });
    const { fetcher } = fakeGmail([], { tokenError: "invalid_grant" });
    const s = await syncMailbox(db, U, { fetcher, backend: fakeBackend(() => []), now: () => T0, log: () => {} });
    expect(s.error).toMatch(/^reconnect needed/);
    expect(getMailAccount(db, U)!.lastError).toMatch(/^reconnect needed/);
    expect(await syncMailbox(db, "nobody", { fetcher, log: () => {} })).toMatchObject({ error: "not connected" });
  });

  it("syncAllMailboxes with dueOnly skips an account synced a moment ago", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    upsertMailAccount(db, { userId: U, email: null, refreshToken: "rt", scope: GMAIL_SCOPE });
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
  function seedGoogleAccount(db: DB, opts: { scope?: string | null; refreshToken?: string | null } = {}) {
    db.prepare("INSERT INTO account (id, accountId, providerId, userId, refreshToken, scope, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)").run(
      "acc-1",
      "google-sub",
      "google",
      U,
      opts.refreshToken === undefined ? "rt-google" : opts.refreshToken,
      opts.scope === undefined ? `openid,email,profile,${GMAIL_SCOPE}` : opts.scope,
      new Date().toISOString(),
      new Date().toISOString()
    );
  }

  it("copies the google account's refresh token once the gmail scope was granted", () => {
    const db = openDb(":memory:");
    seedOwner(db, U, "owner@example.com");
    seedGoogleAccount(db);
    expect(connectFromGoogleAccount(db, U)).toEqual({ email: "owner@example.com", scope: `openid,email,profile,${GMAIL_SCOPE}` });
    expect(getMailAccount(db, U)).toMatchObject({ refreshToken: "rt-google", email: "owner@example.com", enabled: true });
  });

  it("refuses without a google link, without the scope, or without a refresh token", () => {
    const db = openDb(":memory:");
    seedOwner(db);
    expect(() => connectFromGoogleAccount(db, U)).toThrow(InboxConnectError);
    try {
      connectFromGoogleAccount(db, U);
    } catch (e) {
      expect((e as InboxConnectError).code).toBe("no_google");
    }
    seedGoogleAccount(db, { scope: "openid,email,profile" });
    expect(() => connectFromGoogleAccount(db, U)).toThrow(/no_scope/);
    db.prepare("UPDATE account SET scope = ?, refreshToken = NULL WHERE id = 'acc-1'").run(GMAIL_SCOPE);
    expect(() => connectFromGoogleAccount(db, U)).toThrow(/no_refresh_token/);
  });

  it("disconnect deletes the row and revokes the grant, keeping the recorded events", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    upsertMailAccount(db, { userId: U, email: null, refreshToken: "rt", scope: GMAIL_SCOPE });
    const { fetcher, urls } = fakeGmail([]);
    expect(await disconnectMailbox(db, U, { fetcher })).toBe(true);
    expect(getMailAccount(db, U)).toBeNull();
    expect(urls.some((u) => u.startsWith("https://oauth2.googleapis.com/revoke?token=rt"))).toBe(true);
    expect(await disconnectMailbox(db, U, { fetcher })).toBe(false);
    expect(inboxStatus(db, U).connected).toBe(false);
  });
});
