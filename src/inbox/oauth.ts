import crypto from "crypto";
import { GMAIL_SCOPE } from "@/inbox/scope";
import { GmailError } from "@/inbox/google";

// Sortie's own Google consent round-trip for 邮箱同步 (spec 2026-09-21 inbox-sync §3, multi-mailbox
// since the same day). Separate from the login link on purpose: Better Auth only links a Google
// account whose address equals the login email, and a user may read several mailboxes. The
// callback URL (`<base>/api/inbox/google/callback`) is registered on the same OAuth client as the
// login's. Stateless: the `state` parameter is an HMAC-signed, time-limited token naming the
// account that started the flow, so the callback cannot be replayed into another account.

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const STATE_TTL_MS = 10 * 60 * 1000;
export const CALLBACK_PATH = "/api/inbox/google/callback";
// openid + email so the token response's id_token tells us which mailbox was granted.
export const CONNECT_SCOPES = [GMAIL_SCOPE, "openid", "email"];

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

export function signState(secret: string, userId: string, now: number = Date.now()): string {
  const body = b64url(JSON.stringify({ u: userId, t: now, n: crypto.randomBytes(8).toString("hex") }));
  return `${body}.${sign(secret, body)}`;
}

// The account id the state was minted for, or null when it is forged, malformed or expired.
export function verifyState(secret: string, state: string | null | undefined, now: number = Date.now()): string | null {
  if (!state) return null;
  const dot = state.indexOf(".");
  if (dot <= 0) return null;
  const body = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  const expected = sign(secret, body);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u?: unknown; t?: unknown };
    if (typeof parsed.u !== "string" || typeof parsed.t !== "number") return null;
    if (now - parsed.t > STATE_TTL_MS || parsed.t - now > 60_000) return null;
    return parsed.u;
  } catch {
    return null;
  }
}

export function authorizeUrl(opts: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: CONNECT_SCOPES.join(" "),
    access_type: "offline",
    // consent every time so a refresh token is issued even for an address that granted before;
    // select_account so the user can pick a different mailbox than the one they are signed in as.
    prompt: "consent select_account",
    include_granted_scopes: "false",
    state: opts.state,
  });
  if (opts.loginHint) q.set("login_hint", opts.loginHint);
  return `${AUTHORIZE_URL}?${q}`;
}

export interface ExchangedGrant {
  refreshToken: string;
  scope: string;
  email: string;
}

export class ConnectError extends Error {
  code: "denied" | "state" | "exchange" | "no_scope" | "no_refresh_token" | "no_email";
  constructor(code: ConnectError["code"], detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ConnectError";
    this.code = code;
  }
}

// Google's id_token is a JWT signed by Google and delivered straight from the token endpoint over
// TLS, so reading its payload without verifying the signature is safe here (nothing else is
// trusted from it but the address of the mailbox that was just granted).
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" && payload.email.includes("@") ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function exchangeCode(
  code: string,
  opts: { clientId: string; clientSecret: string; redirectUri: string; fetcher?: typeof fetch }
): Promise<ExchangedGrant> {
  const f = opts.fetcher ?? fetch;
  const body = new URLSearchParams({ code, client_id: opts.clientId, client_secret: opts.clientSecret, redirect_uri: opts.redirectUri, grant_type: "authorization_code" });
  const res = await f(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  const json = (await res.json().catch(() => ({}))) as { refresh_token?: string; scope?: string; id_token?: string; error?: string; error_description?: string };
  if (!res.ok) throw new ConnectError("exchange", `${json.error ?? res.status}${json.error_description ? ` (${json.error_description})` : ""}`);
  const scope = json.scope ?? "";
  if (!scope.split(/[\s,]+/).includes(GMAIL_SCOPE)) throw new ConnectError("no_scope", scope);
  if (!json.refresh_token) throw new ConnectError("no_refresh_token");
  const email = emailFromIdToken(json.id_token);
  if (!email) throw new ConnectError("no_email");
  return { refreshToken: json.refresh_token, scope, email };
}

export function requireGoogleCredentials(env: Record<string, string | undefined> = process.env): { clientId: string; clientSecret: string } {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new GmailError("GOOGLE_CLIENT_ID/SECRET are not configured", 500);
  return { clientId, clientSecret };
}
