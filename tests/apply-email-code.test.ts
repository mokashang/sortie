import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type DB } from "@/lib/db";
import { seedOwner } from "./helpers";
import { reportFill, type InfoQuestion } from "@/apply/queue";
import { pendingInfo } from "@/apply/info";
import { resetInboxCachesForTests } from "@/inbox/sync";
import { upsertMailAccount } from "@/inbox/store";
import { GMAIL_SCOPE } from "@/inbox/scope";
import {
  companyTokens,
  extractCode,
  isEmailCodeItem,
  mailMatchesJob,
  pollEmailCodes,
  resetEmailCodesForTests,
  withEmailCodes,
  EMAIL_CODE_POLL_MS,
  EMAIL_CODE_WATCH_MS,
} from "@/apply/email-code";

// Emailed verification codes (agreed 2026-10-07): the App finds the company's code mail and shows
// the code to the user on the card; the assistant never reads mail and never sees the code.

const U = "legacy";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

interface FakeMail {
  id: string;
  from: string;
  subject: string;
  text: string;
  atMs: number;
}

function fakeGmail(mails: FakeMail[]) {
  const urls: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
    const u = new URL(url);
    if (u.pathname.endsWith("/messages")) {
      const after = Number(/after:(\d+)/.exec(u.searchParams.get("q") ?? "")?.[1] ?? 0);
      const list = mails.filter((m) => Math.floor(m.atMs / 1000) > after).sort((a, b) => b.atMs - a.atMs);
      return new Response(JSON.stringify({ messages: list.map((m) => ({ id: m.id, threadId: `t-${m.id}` })) }), { status: 200 });
    }
    const m = mails.find((x) => u.pathname.endsWith(`/messages/${x.id}`));
    if (!m) return new Response("not found", { status: 404 });
    return new Response(
      JSON.stringify({
        id: m.id,
        internalDate: String(m.atMs),
        payload: { mimeType: "text/plain", headers: [{ name: "From", value: m.from }, { name: "Subject", value: m.subject }], body: { data: b64(m.text) } },
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  return { fetcher, urls };
}

function seedCodeCard(db: DB, company: string, item: InfoQuestion): number {
  const jobId = db
    .prepare("INSERT INTO jobs (fingerprint, company, title, apply_url, source) VALUES (?,?,?,?,?)")
    .run(`fp-${Math.random()}`, company, "Software Engineer I", "https://fa-ertb.fa.ocs.oraclecloud.com/apply", "manual").lastInsertRowid as number;
  db.prepare("INSERT INTO matches (user_id, job_id, direction, score, tier) VALUES (?,?,?,?,?)").run(U, jobId, "swe_general", 80, 1);
  db.prepare("INSERT INTO applications (user_id, job_id, status) VALUES (?,?,'prepared')").run(U, jobId);
  reportFill(db, U, { jobId, status: "needs_info", questions: [item] });
  return jobId;
}

beforeEach(() => {
  resetInboxCachesForTests();
  resetEmailCodesForTests();
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "sec";
});

describe("recognizing the code step and the code", () => {
  it("knows an emailed-code item by the protocol key or by how sessions worded it, never a captcha", () => {
    expect(isEmailCodeItem({ kind: "action", key: "email_code", label: "Enter the code" })).toBe(true);
    expect(isEmailCodeItem({ kind: "action", key: "scalis_email_code", label: "Stronghold - code is back to you" })).toBe(true);
    expect(isEmailCodeItem({ kind: "action", key: "verify", label: "Enter the verification code we emailed you" })).toBe(true);
    expect(isEmailCodeItem({ kind: "action", key: "captcha", label: "Tick the hCaptcha box" })).toBe(false);
    expect(isEmailCodeItem({ key: "email_code", label: "a text item" })).toBe(false);
  });

  it("pulls the code that follows (or precedes) a code keyword, not years or words", () => {
    expect(extractCode("Your verification code", "Hi Mengjia,\n\nYour verification code is:\n\n482913\n\nIt expires in 10 minutes.")).toBe("482913");
    expect(extractCode("620551 is your Scalis sign-in code", "")).toBe("620551");
    expect(extractCode("Verify your email", "Use code A7K2Q9 to continue. © 2026 Oracle")).toBe("A7K2Q9");
    expect(extractCode("Confirm your account", "Welcome! Verify your email within 2026 days, step2go")).toBeNull();
    expect(extractCode("您的验证码", "验证码:739104,10 分钟内有效")).toBe("739104");
  });

  it("matches a mail to the job only when it names the company, or comes from the sender the page named", () => {
    expect(companyTokens("Stronghold Investment Management, LLC")).toEqual(["stronghold investment management", "stronghold"]);
    const mail = { from: "Oracle Recruiting <no-reply@oraclecloud.com>", subject: "Your verification code", text: "Thanks for your interest in Photon careers." };
    expect(mailMatchesJob(mail, "Photon")).toBe(true);
    expect(mailMatchesJob(mail, "GM Financial")).toBe(false); // same ATS, different company
    expect(mailMatchesJob({ from: "Photonics Weekly <x@y.com>", subject: "code", text: "" }, "Photon")).toBe(false);
    expect(mailMatchesJob({ from: "no-reply@scalis.ai", subject: "Your code", text: "" }, "Stronghold", "scalis.ai")).toBe(true);
  });
});

describe("pollEmailCodes", () => {
  it("finds the company's code mail after the step, ignores other companies' codes, shows it only through withEmailCodes", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    upsertMailAccount(db, { userId: U, email: "me@example.com", refreshToken: "rt", scope: GMAIL_SCOPE });
    const photon = seedCodeCard(db, "Photon", { kind: "action", key: "photon_email_code", label: "Photon emailed a verification code" });
    const now = Date.now();
    const { fetcher } = fakeGmail([
      { id: "li", from: "LinkedIn <security@linkedin.com>", subject: "Your LinkedIn verification code", text: "Your code is 111111", atMs: now - 20_000 },
      { id: "gm", from: "no-reply@oraclecloud.com", subject: "Verification code", text: "GM Financial careers: your code is 222222", atMs: now - 15_000 },
      { id: "ph", from: "no-reply@oraclecloud.com", subject: "Verification code", text: "Photon careers: your verification code is 482913", atMs: now - 10_000 },
      { id: "old", from: "no-reply@oraclecloud.com", subject: "Verification code", text: "Photon careers: your verification code is 999999", atMs: now - 3 * 3600_000 },
    ]);
    const pushed: string[] = [];
    await pollEmailCodes(db, U, { fetcher, now: () => now, notifier: (title, body) => void pushed.push(`${title} | ${body}`), lang: "en" });

    // The assistant's view of the cards never carries it.
    expect(JSON.stringify(pendingInfo(db, U))).not.toContain("482913");
    const [card] = withEmailCodes(pendingInfo(db, U), U, now);
    expect(card.jobId).toBe(photon);
    expect(card.emailCode).toMatchObject({ key: "photon_email_code", code: "482913", from: "no-reply@oraclecloud.com", watching: true, noMailbox: false });
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toContain("Photon");
    expect(pushed[0]).not.toContain("482913"); // the notification never carries the code
  });

  it("polls each card at most every EMAIL_CODE_POLL_MS, takes a newer code after a resend, and stops after the watch window", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    upsertMailAccount(db, { userId: U, email: "me@example.com", refreshToken: "rt", scope: GMAIL_SCOPE });
    seedCodeCard(db, "Stronghold", { kind: "action", key: "email_code", label: "Enter the code", sender: "scalis.ai" });
    const now = Date.now();
    const mails: FakeMail[] = [{ id: "a", from: "no-reply@scalis.ai", subject: "Your sign-in code", text: "Code: 620551", atMs: now - 5_000 }];
    const { fetcher, urls } = fakeGmail(mails);
    const deps = { fetcher, now: () => now, notifier: () => {} };
    await pollEmailCodes(db, U, deps);
    const listed = () => urls.filter((u) => new URL(u).pathname.endsWith("/messages")).length;
    expect(listed()).toBe(1);
    await pollEmailCodes(db, U, deps); // too soon
    expect(listed()).toBe(1);

    mails.push({ id: "b", from: "no-reply@scalis.ai", subject: "Your sign-in code", text: "Code: 731880", atMs: now + 30_000 });
    await pollEmailCodes(db, U, { ...deps, now: () => now + EMAIL_CODE_POLL_MS + 40_000 });
    expect(withEmailCodes(pendingInfo(db, U), U, now + 60_000)[0].emailCode?.code).toBe("731880");

    const late = now + EMAIL_CODE_WATCH_MS + 60_000;
    await pollEmailCodes(db, U, { ...deps, now: () => late });
    expect(withEmailCodes(pendingInfo(db, U), U, late)[0].emailCode).toMatchObject({ code: null, watching: false });
  });

  it("says so when no mailbox is connected", async () => {
    const db = openDb(":memory:");
    seedOwner(db);
    seedCodeCard(db, "Photon", { kind: "action", key: "email_code", label: "Enter the code" });
    const now = Date.now();
    await pollEmailCodes(db, U, { fetcher: fakeGmail([]).fetcher, now: () => now });
    expect(withEmailCodes(pendingInfo(db, U), U, now)[0].emailCode).toMatchObject({ code: null, noMailbox: true, watching: true });
  });
});
