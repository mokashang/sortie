import type { DB } from "@/lib/db";
import { logEvent } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import type { LlmBackend } from "@/llm/types";
import { notify } from "@/lib/notify";
import { serverLang } from "@/lib/prefs";
import type { Lang } from "@/i18n/lang";
import { GMAIL_SCOPE, GmailError, getMessage, listMessageIds, parseMessage, refreshAccessToken, revokeToken, type ParsedMail } from "@/inbox/google";
import { isCandidateMail } from "@/inbox/filter";
import { classifyMails, type ClassifyMail } from "@/inbox/classify";
import { applyMailResult, inboxNotification, type AppliedMail } from "@/inbox/apply";
import {
  countMailEvents,
  deleteMailAccount,
  earliestSubmissionUnix,
  getMailAccount,
  hasMailEvent,
  listEnabledMailAccounts,
  markSyncError,
  markSynced,
  submittedApplications,
  upsertMailAccount,
} from "@/inbox/store";

// 邮箱同步 orchestration (spec 2026-09-21 inbox-sync §5). One pass per account: refresh the access
// token, list mail newer than the cursor, parse, pre-filter, classify in batches, apply, push
// notifications, advance the cursor. Runs from the 15-minute tick (src/instrumentation.ts ->
// POST /api/inbox/tick) and from 设置's "sync now". Never throws for one account's trouble: the
// error is written to mail_accounts.last_error and shown on 设置.

export const INBOX_SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const FIRST_SYNC_LOOKBACK_S = 30 * 24 * 3600;
export const MAX_MESSAGES_PER_SYNC = 200;
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
}

export interface SyncSummary {
  userId: string;
  fetched: number; // messages listed newer than the cursor (minus already-seen ids)
  candidates: number; // passed the pre-filter and were classified
  matched: number; // filed against one of the user's applications
  applied: number; // moved an application's stage
  notified: number;
  skipped: boolean; // nothing to match against (no submitted applications) — cursor advanced only
  error: string | null;
}

// Access tokens live an hour; one per account per process, refreshed a little early.
type TokenCache = Map<string, { token: string; expiresAt: number }>;
const g = globalThis as unknown as { __sortieInboxTokens?: TokenCache; __sortieInboxBusy?: Set<string> };
function tokenCache(): TokenCache {
  return (g.__sortieInboxTokens ??= new Map());
}
function busy(): Set<string> {
  return (g.__sortieInboxBusy ??= new Set());
}
export function resetInboxCachesForTests(): void {
  g.__sortieInboxTokens = new Map();
  g.__sortieInboxBusy = new Set();
}

async function accessTokenFor(userId: string, refreshToken: string, deps: SyncDeps): Promise<string> {
  const now = deps.now ? deps.now() : Date.now();
  const cached = tokenCache().get(userId);
  if (cached && cached.expiresAt > now) return cached.token;
  const t = await refreshAccessToken(refreshToken, { fetcher: deps.fetcher });
  tokenCache().set(userId, { token: t.accessToken, expiresAt: now + Math.max(60, t.expiresInS - 300) * 1000 });
  return t.accessToken;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

export async function syncMailbox(db: DB, userId: string, deps: SyncDeps = {}): Promise<SyncSummary> {
  const out: SyncSummary = { userId, fetched: 0, candidates: 0, matched: 0, applied: 0, notified: 0, skipped: false, error: null };
  const account = getMailAccount(db, userId);
  if (!account || !account.enabled) {
    out.error = "not connected";
    return out;
  }
  if (busy().has(userId)) {
    out.error = "sync already running";
    return out;
  }
  busy().add(userId);
  const log = deps.log ?? ((l: string) => console.log(l));
  try {
    const now = deps.now ? deps.now() : Date.now();
    const nowS = Math.floor(now / 1000);
    let since = account.watermark;
    if (since == null) {
      const earliest = earliestSubmissionUnix(db, userId);
      since = Math.max(nowS - FIRST_SYNC_LOOKBACK_S, earliest ?? 0);
    }
    const token = await accessTokenFor(userId, account.refreshToken, deps);
    const fetcher = deps.fetcher ?? fetch;
    const refs = await listMessageIds(token, `after:${Math.max(0, since - OVERLAP_S)} ${GMAIL_QUERY_TAIL}`, { max: MAX_MESSAGES_PER_SYNC, fetcher });
    const fresh = refs.filter((r) => !hasMailEvent(db, userId, r.id));
    out.fetched = fresh.length;

    const apps = submittedApplications(db, userId);
    let newest = since;
    if (apps.length === 0) {
      // Nothing to file against yet: advance the cursor past what is there and stop.
      out.skipped = true;
      for (const r of fresh) {
        const m = parseMessage(await getMessage(token, r.id, fetcher));
        newest = Math.max(newest, Math.floor(m.receivedAtMs / 1000));
      }
      markSynced(db, userId, Math.max(newest, since));
      return out;
    }

    const companies = [...new Set(apps.map((a) => a.company))];
    const parsed: ParsedMail[] = [];
    for (const r of fresh) {
      const m = parseMessage(await getMessage(token, r.id, fetcher));
      newest = Math.max(newest, Math.floor(m.receivedAtMs / 1000));
      if (isCandidateMail(m, companies).keep) parsed.push(m);
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
          a = applyMailResult(db, userId, m, r);
        } catch (e) {
          log(`[inbox] ${userId} message ${m.id}: ${e instanceof Error ? e.message : String(e)}`);
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
    markSynced(db, userId, Math.max(newest, since));
    logEvent(db, "inbox_sync", { userId, payload: { fetched: out.fetched, candidates: out.candidates, matched: out.matched, applied: out.applied } });
    log(`[inbox] ${userId}: ${out.fetched} new, ${out.candidates} classified, ${out.matched} matched, ${out.applied} stage changes`);
    return out;
  } catch (e) {
    const msg = e instanceof GmailError && e.status === 401 ? `reconnect needed: ${e.message}` : e instanceof Error ? e.message : String(e);
    out.error = msg;
    markSyncError(db, userId, msg);
    if (e instanceof GmailError && e.status === 401) tokenCache().delete(userId);
    log(`[inbox] ${userId} sync failed: ${msg}`);
    return out;
  } finally {
    busy().delete(userId);
  }
}

// The tick: every connected account that is due. `dueOnly` skips accounts synced less than an
// interval ago, so the 15-minute timer and a manual "sync now" can coexist.
export async function syncAllMailboxes(db: DB, deps: SyncDeps & { dueOnly?: boolean } = {}): Promise<SyncSummary[]> {
  const now = deps.now ? deps.now() : Date.now();
  const out: SyncSummary[] = [];
  for (const a of listEnabledMailAccounts(db)) {
    if (deps.dueOnly && a.syncedAt) {
      const last = Date.parse(`${a.syncedAt.replace(" ", "T")}Z`);
      if (Number.isFinite(last) && now - last < INBOX_SYNC_INTERVAL_MS - 30_000) continue;
    }
    out.push(await syncMailbox(db, a.userId, deps));
  }
  return out;
}

// ---- connect / disconnect / status -------------------------------------------------------

export class InboxConnectError extends Error {
  code: "no_google" | "no_scope" | "no_refresh_token";
  constructor(code: "no_google" | "no_scope" | "no_refresh_token") {
    super(code);
    this.name = "InboxConnectError";
    this.code = code;
  }
}

// After the Gmail link round-trip (设置 -> linkSocial with the gmail.readonly scope -> back), copy
// the refresh token Better Auth stored on the google account row into mail_accounts. The login's
// own token updates later never touch our copy.
export function connectFromGoogleAccount(db: DB, userId: string): { email: string | null; scope: string | null } {
  const row = db
    .prepare('SELECT a.refreshToken as refresh_token, a.scope, u.email FROM account a JOIN "user" u ON u.id = a.userId WHERE a.userId = ? AND a.providerId = ? ORDER BY a.updatedAt DESC LIMIT 1')
    .get(userId, "google") as { refresh_token: string | null; scope: string | null; email: string | null } | undefined;
  if (!row) throw new InboxConnectError("no_google");
  const scopes = (row.scope ?? "").split(/[,\s]+/).filter(Boolean);
  if (!scopes.includes(GMAIL_SCOPE)) throw new InboxConnectError("no_scope");
  if (!row.refresh_token) throw new InboxConnectError("no_refresh_token");
  upsertMailAccount(db, { userId, email: row.email, refreshToken: row.refresh_token, scope: row.scope });
  tokenCache().delete(userId);
  logEvent(db, "inbox_connected", { userId, payload: { email: row.email } });
  return { email: row.email, scope: row.scope };
}

export async function disconnectMailbox(db: DB, userId: string, deps: { fetcher?: typeof fetch } = {}): Promise<boolean> {
  const account = getMailAccount(db, userId);
  if (!account) return false;
  deleteMailAccount(db, userId);
  tokenCache().delete(userId);
  logEvent(db, "inbox_disconnected", { userId });
  await revokeToken(account.refreshToken, deps.fetcher ?? fetch);
  return true;
}

export interface InboxStatus {
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  syncedAt: string | null; // UTC sqlite datetime
  lastError: string | null;
  events: { total: number; matched: number; applied: number };
}

export function inboxStatus(db: DB, userId: string): InboxStatus {
  const a = getMailAccount(db, userId);
  return {
    connected: !!a && a.enabled,
    email: a?.email ?? null,
    connectedAt: a?.connectedAt ?? null,
    syncedAt: a?.syncedAt ?? null,
    lastError: a?.lastError ?? null,
    events: countMailEvents(db, userId),
  };
}
