import type { DB } from "@/lib/db";
import { logEvent } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import type { LlmBackend } from "@/llm/types";
import { notify } from "@/lib/notify";
import { serverLang } from "@/lib/prefs";
import type { Lang } from "@/i18n/lang";
import { GmailError, defaultSleep, getMessage, listMessageIds, parseMessage, refreshAccessToken, revokeToken, type ParsedMail, type Sleeper } from "@/inbox/google";
import { isCandidateMail } from "@/inbox/filter";
import { classifyMails, type ClassifyMail } from "@/inbox/classify";
import { applyMailResult, inboxNotification, type AppliedMail } from "@/inbox/apply";
import {
  countMailEvents,
  deleteMailAccount,
  earliestSubmissionUnix,
  getMailAccount,
  hasMailEvent,
  insertMailEvent,
  newestSeenUnix,
  listEnabledMailAccounts,
  listMailAccounts,
  markSyncError,
  markSynced,
  submittedApplications,
  upsertMailAccount,
  type MailAccountRow,
  type MailEventCounts,
} from "@/inbox/store";
import { exchangeCode, requireGoogleCredentials, type ExchangedGrant } from "@/inbox/oauth";

// 邮箱同步 orchestration (spec 2026-09-21 inbox-sync §5). One pass per mailbox: refresh the access
// token, list mail newer than the cursor, parse, pre-filter, classify in batches, apply, push
// notifications, advance the cursor. Runs from the 15-minute tick (src/instrumentation.ts ->
// POST /api/inbox/tick) and from 设置's "sync now". Never throws for one mailbox's trouble: the
// error is written to mail_accounts.last_error and shown on 设置.

export const INBOX_SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const FIRST_SYNC_LOOKBACK_S = 30 * 24 * 3600;
// How many full messages one pass fetches (each costs 5 quota units; Gmail allows 250 per user per
// second and 15 000 per minute) and the pause between fetches. A backlog larger than this is
// drained over several passes: the cursor stays put until every listed message has been seen.
export const MAX_MESSAGES_PER_SYNC = 60;
export const MAX_LISTED_PER_SYNC = 1000;
export const FETCH_GAP_MS = 120;
// A tick (or "sync now") repeats the pass while a backlog remains, up to this many times, so a
// freshly connected mailbox is read in an hour rather than a day. Each pass stays inside the
// per-minute quota on its own.
export const MAX_PASSES_PER_RUN = 6;
// Gmail's after: is whole seconds and the cursor is the newest mail seen, so re-read a little
// overlap; anything already in mail_events is skipped by id, the rest is cheap to re-filter.
const OVERLAP_S = 120;
const GMAIL_QUERY_TAIL = "-in:spam -in:trash -category:promotions -category:social";

export interface SyncDeps {
  fetcher?: typeof fetch;
  backend?: LlmBackend;
  now?: () => number;
  notifier?: (title: string, body: string) => Promise<void> | void;
  lang?: Lang;
  log?: (line: string) => void;
  sleep?: Sleeper;
}

export interface SyncSummary {
  accountId: number;
  email: string;
  fetched: number; // messages listed newer than the cursor (minus already-seen ids)
  candidates: number; // passed the pre-filter and were classified
  matched: number; // filed against one of the user's applications
  applied: number; // moved an application's stage
  notified: number;
  skipped: boolean; // nothing to match against (no submitted applications) — cursor advanced only
  backlog: number; // listed-but-unfetched messages left for the next pass
  error: string | null;
}

// Access tokens live an hour; one per mailbox per process, refreshed a little early.
type TokenCache = Map<number, { token: string; expiresAt: number }>;
const g = globalThis as unknown as { __sortieInboxTokens?: TokenCache; __sortieInboxBusy?: Set<number> };
function tokenCache(): TokenCache {
  return (g.__sortieInboxTokens ??= new Map());
}
function busy(): Set<number> {
  return (g.__sortieInboxBusy ??= new Set());
}
export function resetInboxCachesForTests(): void {
  g.__sortieInboxTokens = new Map();
  g.__sortieInboxBusy = new Set();
}

async function accessTokenFor(account: MailAccountRow, deps: SyncDeps): Promise<string> {
  const now = deps.now ? deps.now() : Date.now();
  const cached = tokenCache().get(account.id);
  if (cached && cached.expiresAt > now) return cached.token;
  const t = await refreshAccessToken(account.refreshToken, { fetcher: deps.fetcher });
  tokenCache().set(account.id, { token: t.accessToken, expiresAt: now + Math.max(60, t.expiresInS - 300) * 1000 });
  return t.accessToken;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

// The one line 设置 shows for a failed sync. Google's two operator-fixable refusals get a plain
// sentence instead of the raw JSON body: a lapsed grant (reconnect), and the Gmail API not yet
// enabled on the Cloud project the OAuth client belongs to (2026-09-21 first connect: the login
// client had never called Gmail, so every request answered 403 until the API was switched on).
export function describeSyncError(e: unknown): string {
  if (e instanceof GmailError) {
    if (e.status === 401) return `reconnect needed: ${e.message}`;
    if (e.status === 403 && /has not been used in project|is disabled/i.test(e.message)) {
      const url = e.message.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/gmail[^\s"\\]*/)?.[0];
      return `Gmail API is not enabled on the Google Cloud project${url ? ` — enable it at ${url}` : ""}, then sync again`;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

export async function syncMailbox(db: DB, account: MailAccountRow, deps: SyncDeps = {}): Promise<SyncSummary> {
  const userId = account.userId;
  const out: SyncSummary = { accountId: account.id, email: account.email, fetched: 0, candidates: 0, matched: 0, applied: 0, notified: 0, skipped: false, backlog: 0, error: null };
  if (!account.enabled) {
    out.error = "disabled";
    return out;
  }
  if (busy().has(account.id)) {
    out.error = "sync already running";
    return out;
  }
  busy().add(account.id);
  const log = deps.log ?? ((l: string) => console.log(l));
  try {
    const now = deps.now ? deps.now() : Date.now();
    const nowS = Math.floor(now / 1000);
    let since = account.watermark;
    if (since == null) {
      const earliest = earliestSubmissionUnix(db, userId);
      since = Math.max(nowS - FIRST_SYNC_LOOKBACK_S, earliest ?? 0);
    }
    const token = await accessTokenFor(account, deps);
    const fetcher = deps.fetcher ?? fetch;
    const sleep = deps.sleep ?? defaultSleep;
    const refs = await listMessageIds(token, `after:${Math.max(0, since - OVERLAP_S)} ${GMAIL_QUERY_TAIL}`, { max: MAX_LISTED_PER_SYNC, fetcher, sleep });
    const unseen = refs.filter((r) => !hasMailEvent(db, account.id, r.id));
    const fresh = unseen.slice(0, MAX_MESSAGES_PER_SYNC);
    out.fetched = fresh.length;
    out.backlog = unseen.length - fresh.length;
    // Gmail lists newest first, so a capped pass has seen the newest mail but not the oldest: the
    // cursor may only move once nothing unseen is left behind it.
    const advance = out.backlog === 0;

    const apps = submittedApplications(db, userId);
    let newest = since;
    const fetchOne = async (id: string, i: number): Promise<ParsedMail> => {
      if (i > 0) await sleep(FETCH_GAP_MS);
      const m = parseMessage(await getMessage(token, id, fetcher, sleep));
      newest = Math.max(newest, Math.floor(m.receivedAtMs / 1000));
      return m;
    };
    // A mail the pre-filter drops is still recorded (outcome unrelated, confidence null) so the
    // next pass does not fetch it again; the 历史 feed hides unrelated rows.
    const recordSeen = (m: ParsedMail) =>
      insertMailEvent(db, {
        userId,
        accountId: account.id,
        messageId: m.id,
        threadId: m.threadId,
        receivedAt: new Date(m.receivedAtMs).toISOString().slice(0, 19).replace("T", " "),
        from: m.from,
        subject: m.subject,
        snippet: m.snippet,
        jobId: null,
        outcome: "unrelated",
        confidence: null,
        summary: "",
        nextStep: null,
        applied: false,
        stageFrom: null,
        stageTo: null,
      });

    if (apps.length === 0) {
      // Nothing to file against yet: mark what is there as seen and stop.
      out.skipped = true;
      for (const [i, r] of fresh.entries()) recordSeen(await fetchOne(r.id, i));
      markSynced(db, account.id, advance ? Math.max(newest, since, newestSeenUnix(db, account.id) ?? 0) : since);
      return out;
    }

    const companies = [...new Set(apps.map((a) => a.company))];
    const parsed: ParsedMail[] = [];
    for (const [i, r] of fresh.entries()) {
      const m = await fetchOne(r.id, i);
      if (isCandidateMail(m, companies).keep) parsed.push(m);
      else recordSeen(m);
    }
    out.candidates = parsed.length;

    if (parsed.length > 0) {
      const backend = deps.backend ?? getBackend();
      // Oldest first, so a rejection that follows an interview invite in the same batch lands last.
      parsed.sort((a, b) => a.receivedAtMs - b.receivedAtMs);
      const inputs: ClassifyMail[] = parsed.map((m) => ({ id: m.id, from: m.from, subject: m.subject, receivedAt: isoOf(m.receivedAtMs), text: m.text }));
      const results = await classifyMails(backend, inputs, apps);
      const lang = deps.lang ?? serverLang();
      const notifier = deps.notifier ?? ((t: string, b: string) => notify(t, b));
      const byId = new Map(results.map((r) => [r.message_id, r]));
      for (const m of parsed) {
        const r = byId.get(m.id);
        if (!r) continue;
        let a: AppliedMail;
        try {
          a = applyMailResult(db, userId, account.id, m, r);
        } catch (e) {
          log(`[inbox] ${account.email} message ${m.id}: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        if (a.jobId != null) out.matched++;
        if (a.applied) out.applied++;
        if (a.notify) {
          const n = inboxNotification(lang, a);
          try {
            await notifier(n.title, n.body);
            out.notified++;
          } catch (e) {
            log(`[inbox] notify failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    }
    markSynced(db, account.id, advance ? Math.max(newest, since, newestSeenUnix(db, account.id) ?? 0) : since);
    logEvent(db, "inbox_sync", { userId, payload: { accountId: account.id, email: account.email, fetched: out.fetched, candidates: out.candidates, matched: out.matched, applied: out.applied, backlog: out.backlog } });
    log(`[inbox] ${account.email}: ${out.fetched} new, ${out.candidates} classified, ${out.matched} matched, ${out.applied} stage changes${out.backlog ? `, ${out.backlog} left for the next pass` : ""}`);
    return out;
  } catch (e) {
    const msg = describeSyncError(e);
    out.error = msg;
    markSyncError(db, account.id, msg);
    if (e instanceof GmailError && e.status === 401) tokenCache().delete(account.id);
    log(`[inbox] ${account.email} sync failed: ${msg}`);
    return out;
  } finally {
    busy().delete(account.id);
  }
}

// Passes over one mailbox until its backlog is gone or the pass budget is spent; the summary
// returned is the total of the passes (backlog = what is still left).
export async function drainMailbox(db: DB, account: MailAccountRow, deps: SyncDeps & { maxPasses?: number } = {}): Promise<SyncSummary> {
  const max = deps.maxPasses ?? MAX_PASSES_PER_RUN;
  let total: SyncSummary | null = null;
  let current = account;
  for (let pass = 0; pass < max; pass++) {
    const s = await syncMailbox(db, current, deps);
    total = total
      ? { ...s, fetched: total.fetched + s.fetched, candidates: total.candidates + s.candidates, matched: total.matched + s.matched, applied: total.applied + s.applied, notified: total.notified + s.notified }
      : s;
    if (s.error || s.backlog === 0) break;
    const next = getMailAccount(db, account.userId, account.id);
    if (!next) break;
    current = next;
  }
  return total as SyncSummary;
}

// One account's mailboxes (all of them, or just `accountId`), for 设置's "sync now".
export async function syncUserMailboxes(db: DB, userId: string, deps: SyncDeps & { accountId?: number; maxPasses?: number } = {}): Promise<SyncSummary[]> {
  const rows = deps.accountId != null ? [getMailAccount(db, userId, deps.accountId)].filter((r): r is MailAccountRow => !!r) : listMailAccounts(db, userId);
  const out: SyncSummary[] = [];
  for (const a of rows) out.push(await drainMailbox(db, a, deps));
  return out;
}

// The tick: every connected mailbox that is due. `dueOnly` skips ones synced less than an
// interval ago, so the 15-minute timer and a manual "sync now" can coexist.
export async function syncAllMailboxes(db: DB, deps: SyncDeps & { dueOnly?: boolean; maxPasses?: number } = {}): Promise<SyncSummary[]> {
  const now = deps.now ? deps.now() : Date.now();
  const out: SyncSummary[] = [];
  for (const a of listEnabledMailAccounts(db)) {
    if (deps.dueOnly && a.syncedAt) {
      const last = Date.parse(`${a.syncedAt.replace(" ", "T")}Z`);
      if (Number.isFinite(last) && now - last < INBOX_SYNC_INTERVAL_MS - 30_000) continue;
    }
    out.push(await drainMailbox(db, a, deps));
  }
  return out;
}

// ---- connect / disconnect / status -------------------------------------------------------

// The callback half of the consent round-trip (src/inbox/oauth.ts): exchange the code, keep the
// refresh token under (user, address), forget any cached access token for that mailbox.
export async function completeGoogleConnect(
  db: DB,
  userId: string,
  code: string,
  opts: { redirectUri: string; fetcher?: typeof fetch; env?: Record<string, string | undefined> }
): Promise<MailAccountRow> {
  const creds = requireGoogleCredentials(opts.env);
  const grant: ExchangedGrant = await exchangeCode(code, { ...creds, redirectUri: opts.redirectUri, fetcher: opts.fetcher });
  const row = upsertMailAccount(db, { userId, email: grant.email, refreshToken: grant.refreshToken, scope: grant.scope });
  tokenCache().delete(row.id);
  logEvent(db, "inbox_connected", { userId, payload: { accountId: row.id, email: row.email } });
  return row;
}

export async function disconnectMailbox(db: DB, userId: string, accountId: number, deps: { fetcher?: typeof fetch } = {}): Promise<boolean> {
  const account = getMailAccount(db, userId, accountId);
  if (!account) return false;
  deleteMailAccount(db, userId, accountId);
  tokenCache().delete(accountId);
  logEvent(db, "inbox_disconnected", { userId, payload: { accountId, email: account.email } });
  await revokeToken(account.refreshToken, deps.fetcher ?? fetch);
  return true;
}

export interface MailboxStatus {
  id: number;
  email: string;
  connectedAt: string;
  syncedAt: string | null; // UTC sqlite datetime
  lastError: string | null;
  events: MailEventCounts;
}

export interface InboxStatus {
  mailboxes: MailboxStatus[];
  events: MailEventCounts;
}

export function inboxStatus(db: DB, userId: string): InboxStatus {
  return {
    mailboxes: listMailAccounts(db, userId).map((a) => ({
      id: a.id,
      email: a.email,
      connectedAt: a.connectedAt,
      syncedAt: a.syncedAt,
      lastError: a.lastError,
      events: countMailEvents(db, userId, a.id),
    })),
    events: countMailEvents(db, userId),
  };
}
