import type { DB } from "@/lib/db";
import { logEvent } from "@/lib/db";
import { messages } from "@/i18n/messages";
import type { Lang } from "@/i18n/lang";
import { serverLang } from "@/lib/prefs";
import { notify } from "@/lib/notify";
import { infoKind, type InfoQuestion } from "@/apply/queue";
import type { PendingInfoRow } from "@/apply/info";
import { listMailAccounts } from "@/inbox/store";
import { getMessage, listMessageIds, parseMessage, type ParsedMail } from "@/inbox/google";
import { accessTokenFor } from "@/inbox/sync";

// Emailed verification codes on the 待处理 card (agreed with the user 2026-10-07, built 2026-10-15).
// Some applications stop on "we sent a
// code to your email" (Oracle candidate verification, Scalis, Amazon). The user asked the assistant
// to fetch the code from their mailbox and type it in; that stays theirs — a code is a sign-in
// credential, and an assistant that reads every page a stranger wrote and also pulls "the newest
// code" out of the mailbox can be talked into handing over the Google / LinkedIn / bank code a
// fake page just triggered. What the App does instead is save the user the hunt and the race
// against expiry: the moment the assistant reports the code step, it watches the connected
// mailboxes (read-only, the 邮箱同步 grant) for a mail from *that company* sent after the step,
// pulls the code out, shows it on the card and pushes a notification without the code in it. The
// user types it into the open tab and ticks 完成了; the assistant carries on.
//
// The code never leaves this process for anyone but the signed-in user in their browser: it is
// kept in memory only (not in the database, not in backups, not in logs or the notification),
// and GET /api/apply/pending attaches it only for a browser session, never for an assistant's
// token (src/app/api/apply/pending/route.ts).

export const EMAIL_CODE_KEY = "email_code";
// How long after the code step the mailbox is watched, and how often per card.
export const EMAIL_CODE_WATCH_MS = 30 * 60_000;
export const EMAIL_CODE_POLL_MS = 15_000;
// A code mail can be stamped a little before the card (clock skew, the assistant reports after it
// clicked "send code"); older than this before the step is someone else's code.
const SENT_BEFORE_STEP_MS = 5 * 60_000;

// An action item for an emailed code: the protocol key, or what sessions wrote before it existed
// ("scalis_email_code", "Enter the verification code we emailed you"). A captcha is never one.
export function isEmailCodeItem(q: InfoQuestion): boolean {
  if (infoKind(q) !== "action") return false;
  if (q.key === EMAIL_CODE_KEY) return true;
  const s = `${q.key} ${q.label}`.toLowerCase();
  if (/captcha|人机|图形|robot/.test(s)) return false;
  return /(e-?mail|邮箱|邮件)[\s_-]?.{0,24}(code|码)|verification[\s_-]?code|one[\s_-]?time[\s_-]?(pass)?code|\botp\b|passcode|验证码/.test(s);
}

// --- matching a mail to the job ---------------------------------------------------------------

const COMPANY_SUFFIX = /\b(inc|llc|corp|corporation|co|ltd|limited|plc|group|holdings|company|technologies|technology|labs)\b/g;

export function companyTokens(company: string): string[] {
  const base = company
    .toLowerCase()
    .replace(/[,.()&]/g, " ")
    .replace(COMPANY_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
  const out = new Set<string>();
  if (base.length >= 3) out.add(base);
  const first = base.split(" ")[0];
  if (first && first.length >= 5) out.add(first);
  return [...out];
}

function containsWord(hay: string, token: string): boolean {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(hay);
}

// The mail has to name the company (sender, subject or body) — an ATS domain alone is not enough,
// two Oracle-hosted companies send from the same one — or come from the sender the assistant read
// on the page.
export function mailMatchesJob(mail: Pick<ParsedMail, "from" | "subject" | "text">, company: string, senderHint?: string): boolean {
  const hay = `${mail.from}\n${mail.subject}\n${mail.text}`.toLowerCase();
  if (companyTokens(company).some((t) => containsWord(hay, t))) return true;
  const hint = (senderHint ?? "").toLowerCase().trim();
  return hint.length >= 4 && mail.from.toLowerCase().includes(hint);
}

// --- pulling the code out ---------------------------------------------------------------------

const KEYWORD = /(verification|verify|one[- ]?time|passcode|pass code|\bcode\b|\botp\b|验证码)/gi;
const NUMERIC = /\b\d{4,8}\b/g;
const ALNUM = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8}\b/g; // case-sensitive on purpose: "A7K2Q9", not "step2go"

function candidates(window: string): string[] {
  const out: { at: number; v: string }[] = [];
  for (const m of window.matchAll(NUMERIC)) {
    const v = m[0];
    if (v.length === 4 && /^(19|20)\d\d$/.test(v)) continue; // a year, not a code
    out.push({ at: m.index ?? 0, v });
  }
  for (const m of window.matchAll(ALNUM)) out.push({ at: m.index ?? 0, v: m[0] });
  return out.sort((a, b) => a.at - b.at).map((c) => c.v);
}

// The code a verification mail carries: the first plausible code right after a code keyword
// (the subject first, then the body), else one just before it ("482913 is your code"). null when
// nothing looks like one — the card then points the user at the mail itself.
export function extractCode(subject: string, text: string): string | null {
  for (const source of [subject, text]) {
    for (const k of source.matchAll(KEYWORD)) {
      const at = (k.index ?? 0) + k[0].length;
      const after = candidates(source.slice(at, at + 140));
      if (after.length > 0) return after[0];
      const before = candidates(source.slice(Math.max(0, (k.index ?? 0) - 40), k.index ?? 0));
      if (before.length > 0) return before[before.length - 1];
    }
  }
  return null;
}

// --- the watcher ------------------------------------------------------------------------------

interface CodeState {
  askedAt: string; // the card's updated_at when the watch started (a re-report starts over)
  code: string | null;
  from: string | null;
  subject: string | null;
  receivedAtMs: number | null;
  messageId: string | null;
  checkedAtMs: number;
  seen: Set<string>;
  noMailbox: boolean;
}

const g = globalThis as unknown as { __sortieEmailCodes?: Map<string, CodeState>; __sortieEmailCodePoll?: Promise<void> | null };
function states(): Map<string, CodeState> {
  return (g.__sortieEmailCodes ??= new Map());
}
const stateKey = (userId: string, jobId: number) => `${userId}:${jobId}`;
export function resetEmailCodesForTests(): void {
  g.__sortieEmailCodes = new Map();
  g.__sortieEmailCodePoll = null;
}

// SQLite UTC text -> epoch ms.
const sqliteMs = (s: string) => Date.parse(s.replace(" ", "T") + "Z");

export interface EmailCodeDeps {
  fetcher?: typeof fetch;
  now?: () => number;
  notifier?: (title: string, body: string) => Promise<void> | void;
  lang?: Lang;
}

interface WatchedRow {
  job_id: number;
  company: string;
  pending_questions: string;
  updated_at: string;
}

// From the dispatcher tick (every 10 s): for each open code step younger than the watch window,
// look through the mailboxes for the company's code mail, at most once per EMAIL_CODE_POLL_MS per
// card. One sweep at a time per process; never throws.
export function pollEmailCodes(db: DB, userId: string, deps: EmailCodeDeps = {}): Promise<void> {
  if (g.__sortieEmailCodePoll) return g.__sortieEmailCodePoll;
  g.__sortieEmailCodePoll = (async () => {
    try {
      await sweep(db, userId, deps);
    } catch (e) {
      console.error("[email-code] sweep failed", e);
    }
  })().finally(() => {
    g.__sortieEmailCodePoll = null;
  });
  return g.__sortieEmailCodePoll;
}

async function sweep(db: DB, userId: string, deps: EmailCodeDeps): Promise<void> {
  const now = deps.now ? deps.now() : Date.now();
  const rows = db
    .prepare(
      `SELECT a.job_id, j.company, a.pending_questions, a.updated_at FROM applications a JOIN jobs j ON j.id = a.job_id
       WHERE a.user_id = ? AND a.status = 'needs_info' AND a.pending_questions LIKE '%"action"%'`
    )
    .all(userId) as WatchedRow[];
  const open = new Set<string>();
  const due: { row: WatchedRow; item: InfoQuestion; state: CodeState }[] = [];
  for (const row of rows) {
    let items: InfoQuestion[] = [];
    try {
      items = JSON.parse(row.pending_questions) as InfoQuestion[];
    } catch {
      continue;
    }
    const item = items.find(isEmailCodeItem);
    if (!item) continue;
    const askedMs = sqliteMs(row.updated_at);
    if (!(now - askedMs < EMAIL_CODE_WATCH_MS)) continue;
    const key = stateKey(userId, row.job_id);
    open.add(key);
    let state = states().get(key);
    if (!state || state.askedAt !== row.updated_at) {
      state = { askedAt: row.updated_at, code: null, from: null, subject: null, receivedAtMs: null, messageId: null, checkedAtMs: 0, seen: new Set(), noMailbox: false };
      states().set(key, state);
    }
    if (now - state.checkedAtMs >= EMAIL_CODE_POLL_MS) due.push({ row, item, state });
  }
  // Steps that were answered, skipped or aged out take their code with them.
  for (const key of [...states().keys()]) if (key.startsWith(`${userId}:`) && !open.has(key)) states().delete(key);
  if (due.length === 0) return;

  const accounts = listMailAccounts(db, userId).filter((a) => a.enabled);
  for (const { row, item, state } of due) {
    state.checkedAtMs = now;
    state.noMailbox = accounts.length === 0;
    if (state.noMailbox) continue;
    const askedMs = sqliteMs(row.updated_at);
    const afterUnix = Math.floor((askedMs - SENT_BEFORE_STEP_MS) / 1000);
    let best: { mail: ParsedMail; code: string | null } | null = null;
    for (const account of accounts) {
      try {
        const token = await accessTokenFor(account, { fetcher: deps.fetcher, now: deps.now });
        const refs = await listMessageIds(token, `after:${afterUnix} (code OR verification OR verify OR passcode OR otp OR 验证码)`, { max: 10, fetcher: deps.fetcher });
        for (const ref of refs) {
          const seenKey = `${account.id}:${ref.id}`;
          if (state.seen.has(seenKey)) continue;
          state.seen.add(seenKey);
          const mail = parseMessage(await getMessage(token, ref.id, deps.fetcher ?? fetch));
          if (mail.receivedAtMs < askedMs - SENT_BEFORE_STEP_MS) continue;
          if (!mailMatchesJob(mail, row.company, item.sender)) continue;
          if (!best || mail.receivedAtMs > best.mail.receivedAtMs) best = { mail, code: extractCode(mail.subject, mail.text) };
        }
      } catch (e) {
        console.error(`[email-code] mailbox ${account.id} for job ${row.job_id}:`, e instanceof Error ? e.message : e);
      }
    }
    if (!best || (state.receivedAtMs != null && best.mail.receivedAtMs <= state.receivedAtMs)) continue;
    state.code = best.code;
    state.from = best.mail.from;
    state.subject = best.mail.subject;
    state.receivedAtMs = best.mail.receivedAtMs;
    state.messageId = best.mail.id;
    logEvent(db, "application_email_code_found", { userId, entity: "application", entityId: row.job_id, payload: { recognized: best.code != null } });
    const t = messages[deps.lang ?? serverLang()].notify.emailCode;
    void (deps.notifier ?? ((title: string, body: string) => notify(title, body, { priority: "high" })))(t.title(row.company), t.body);
  }
}

export interface EmailCodeView {
  key: string; // the card item it belongs to
  code: string | null;
  from: string | null;
  subject: string | null;
  receivedAt: string | null; // ISO
  watching: boolean; // still inside the watch window
  noMailbox: boolean;
}

// The cards as the signed-in user sees them: each open code step with what the watcher found.
// Only ever called for a browser session (see the header comment).
export function withEmailCodes(rows: PendingInfoRow[], userId: string, now = Date.now()): (PendingInfoRow & { emailCode?: EmailCodeView })[] {
  return rows.map((row) => {
    const item = row.status === "needs_info" ? row.questions.find(isEmailCodeItem) : undefined;
    if (!item) return row;
    const s = states().get(stateKey(userId, row.jobId));
    const askedMs = s ? sqliteMs(s.askedAt) : sqliteMs(row.askedAtUtc);
    return {
      ...row,
      emailCode: {
        key: item.key,
        code: s?.code ?? null,
        from: s?.from ?? null,
        subject: s?.subject ?? null,
        receivedAt: s?.receivedAtMs != null ? new Date(s.receivedAtMs).toISOString() : null,
        watching: now - askedMs < EMAIL_CODE_WATCH_MS,
        noMailbox: s?.noMailbox ?? false,
      },
    };
  });
}
