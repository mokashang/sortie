// Gmail, read-only, through plain fetch (spec 2026-09-21 inbox-sync §5). No SDK: three endpoints
// (token refresh, message list, message get) and one revoke. The refresh token comes from
// mail_accounts (src/inbox/store.ts); the access token it buys lives only in memory.
//
// Everything a message contains is untrusted data from strangers — this module only parses it
// into headers + text; nothing here ever acts on what a mail says.

import { GMAIL_SCOPE } from "@/inbox/scope";
export { GMAIL_SCOPE };
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GoogleDeps {
  fetcher?: typeof fetch;
  clientId?: string;
  clientSecret?: string;
}

export class GmailError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GmailError";
    this.status = status;
  }
}

function creds(deps: GoogleDeps): { clientId: string; clientSecret: string } {
  const clientId = deps.clientId ?? process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = deps.clientSecret ?? process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new GmailError("GOOGLE_CLIENT_ID/SECRET are not configured", 500);
  return { clientId, clientSecret };
}

// A fresh access token for the mailbox. Google answers `invalid_grant` once the user revoked the
// grant (or changed their password); that is surfaced as a 401 so the caller can tell the user
// to reconnect instead of retrying forever.
export async function refreshAccessToken(refreshToken: string, deps: GoogleDeps = {}): Promise<{ accessToken: string; expiresInS: number }> {
  const f = deps.fetcher ?? fetch;
  const { clientId, clientSecret } = creds(deps);
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" });
  const res = await f(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) {
    const status = json.error === "invalid_grant" ? 401 : res.status || 500;
    throw new GmailError(`token refresh failed: ${json.error ?? res.status}${json.error_description ? ` (${json.error_description})` : ""}`, status);
  }
  return { accessToken: json.access_token, expiresInS: json.expires_in ?? 3600 };
}

async function api<T>(accessToken: string, path: string, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(`${API}${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GmailError(`gmail ${path.split("?")[0]} -> ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}

export interface MessageRef {
  id: string;
  threadId: string;
}

// Message ids matching a Gmail search query, newest first, at most `max` across pages.
export async function listMessageIds(accessToken: string, query: string, opts: { max?: number; fetcher?: typeof fetch } = {}): Promise<MessageRef[]> {
  const f = opts.fetcher ?? fetch;
  const max = opts.max ?? 200;
  const out: MessageRef[] = [];
  let pageToken: string | undefined;
  while (out.length < max) {
    const pageSize = Math.min(100, max - out.length);
    const q = new URLSearchParams({ q: query, maxResults: String(pageSize) });
    if (pageToken) q.set("pageToken", pageToken);
    const page = await api<{ messages?: MessageRef[]; nextPageToken?: string }>(accessToken, `/messages?${q}`, f);
    for (const m of page.messages ?? []) out.push({ id: m.id, threadId: m.threadId });
    if (!page.nextPageToken || !(page.messages?.length)) break;
    pageToken = page.nextPageToken;
  }
  return out;
}

// The subset of Gmail's `users.messages.get?format=full` shape this module reads.
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string; // ms since epoch, as a string
  payload?: GmailPart;
}

export async function getMessage(accessToken: string, id: string, fetcher: typeof fetch = fetch): Promise<GmailMessage> {
  return api<GmailMessage>(accessToken, `/messages/${encodeURIComponent(id)}?format=full`, fetcher);
}

export interface ParsedMail {
  id: string;
  threadId: string | null;
  from: string;
  subject: string;
  receivedAtMs: number;
  snippet: string;
  text: string; // plain text body (html stripped when there is no text/plain part)
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

// A rough text rendering of an HTML mail: scripts/styles dropped, block tags become line breaks,
// entities decoded, whitespace collapsed. Good enough for a classifier; never shown to the user.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function header(part: GmailPart | undefined, name: string): string {
  const h = part?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function collectBodies(part: GmailPart | undefined, out: { plain: string[]; html: string[] }): void {
  if (!part) return;
  const type = (part.mimeType ?? "").toLowerCase();
  if (part.body?.data && !part.filename) {
    if (type === "text/plain") out.plain.push(decodeBase64Url(part.body.data));
    else if (type === "text/html") out.html.push(decodeBase64Url(part.body.data));
  }
  for (const p of part.parts ?? []) collectBodies(p, out);
}

export const MAX_MAIL_TEXT = 6000;

export function parseMessage(raw: GmailMessage): ParsedMail {
  const bodies = { plain: [] as string[], html: [] as string[] };
  collectBodies(raw.payload, bodies);
  let text = bodies.plain.join("\n").trim();
  if (!text && bodies.html.length) text = htmlToText(bodies.html.join("\n"));
  if (!text) text = raw.snippet ?? "";
  text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").slice(0, MAX_MAIL_TEXT);
  const dateHeader = header(raw.payload, "Date");
  const fromHeader = Number(raw.internalDate);
  const receivedAtMs = Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : Date.parse(dateHeader) || Date.now();
  return {
    id: raw.id,
    threadId: raw.threadId ?? null,
    from: header(raw.payload, "From"),
    subject: header(raw.payload, "Subject"),
    receivedAtMs,
    snippet: (raw.snippet ?? "").slice(0, 300),
    text,
  };
}

// The address part of a From header ("Acme Recruiting <no-reply@acme.com>" -> "no-reply@acme.com").
export function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

export function domainOf(from: string): string {
  const addr = addressOf(from);
  const at = addr.lastIndexOf("@");
  return at >= 0 ? addr.slice(at + 1) : "";
}

// Best effort: tells Google the grant is no longer wanted. Failure is not an error for the
// caller — the row is gone either way.
export async function revokeToken(token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}
