import crypto from "crypto";
import type { DB } from "@/lib/db";

// Bearer tokens (spec 2026-09-13 accounts §2). Two kinds share one table:
//   personal — minted by the user on 设置 → 账号 for an attended session / script on their own
//              machine; never expires unless revoked.
//   run      — minted by the server for one executor run (headless `claude -p`, or the CLI
//              attended session the dispatcher spawns) and handed over in the prompt; bound to
//              that run + user; an attended session keeps it for its whole life (revoked when the
//              dispatcher reaps the session), a headless run token dies when its run finishes.
// The plaintext is shown exactly once; the table stores sha256(token) and a display prefix.

export const TOKEN_PREFIX = "sortie_";
// Long: an attended session keeps its token for its whole life (revoked when the dispatcher reaps it);
// the expiry is only a safety net for a token nobody revoked.
export const RUN_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TokenKind = "personal" | "run";

export interface TokenRow {
  id: number;
  userId: string;
  kind: TokenKind;
  name: string;
  prefix: string;
  runId: number | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function looksLikeToken(s: string): boolean {
  return s.startsWith(TOKEN_PREFIX) && s.length >= TOKEN_PREFIX.length + 32;
}

export interface CreateTokenInput {
  userId: string;
  kind?: TokenKind;
  name: string;
  runId?: number | null;
  expiresAt?: Date | null;
}

export function createToken(db: DB, input: CreateTokenInput): { token: string; row: TokenRow } {
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
  const prefix = token.slice(0, TOKEN_PREFIX.length + 6);
  const kind: TokenKind = input.kind ?? "personal";
  const name = input.name.trim().slice(0, 80) || (kind === "run" ? `run #${input.runId ?? "?"}` : "token");
  const info = db
    .prepare(
      "INSERT INTO api_tokens (user_id, kind, name, token_hash, prefix, run_id, expires_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(input.userId, kind, name, hashToken(token), prefix, input.runId ?? null, input.expiresAt ? input.expiresAt.toISOString() : null);
  const row = getToken(db, Number(info.lastInsertRowid))!;
  return { token, row };
}

export function createRunToken(db: DB, userId: string, runId: number, now = new Date()): string {
  return createToken(db, { userId, kind: "run", name: `run #${runId}`, runId, expiresAt: new Date(now.getTime() + RUN_TOKEN_TTL_MS) }).token;
}

interface RawRow {
  id: number;
  user_id: string;
  kind: string;
  name: string;
  prefix: string;
  run_id: number | null;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

function toRow(r: RawRow): TokenRow {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind === "run" ? "run" : "personal",
    name: r.name,
    prefix: r.prefix,
    runId: r.run_id,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  };
}

const COLS = "id, user_id, kind, name, prefix, run_id, expires_at, last_used_at, created_at";

export function getToken(db: DB, id: number): TokenRow | null {
  const r = db.prepare(`SELECT ${COLS} FROM api_tokens WHERE id = ?`).get(id) as RawRow | undefined;
  return r ? toRow(r) : null;
}

// Resolve a presented bearer token: null when unknown, expired or malformed. Stamps last_used_at
// (at most once a minute, so the 5-second polling loops don't write on every request).
export function verifyToken(db: DB, token: string, now = new Date()): TokenRow | null {
  if (!looksLikeToken(token)) return null;
  const r = db.prepare(`SELECT ${COLS} FROM api_tokens WHERE token_hash = ?`).get(hashToken(token)) as RawRow | undefined;
  if (!r) return null;
  if (r.expires_at && Date.parse(r.expires_at) < now.getTime()) return null;
  const last = r.last_used_at ? Date.parse(r.last_used_at) : 0;
  if (now.getTime() - last > 60_000) {
    db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(now.toISOString(), r.id);
  }
  return toRow(r);
}

// The user's own personal tokens (run tokens are the server's business and never listed).
export function listPersonalTokens(db: DB, userId: string): TokenRow[] {
  return (db.prepare(`SELECT ${COLS} FROM api_tokens WHERE user_id = ? AND kind = 'personal' ORDER BY id DESC`).all(userId) as RawRow[]).map(toRow);
}

export function revokeToken(db: DB, userId: string, id: number): boolean {
  return db.prepare("DELETE FROM api_tokens WHERE user_id = ? AND id = ? AND kind = 'personal'").run(userId, id).changes > 0;
}

export function revokeRunTokens(db: DB, runId: number): number {
  return db.prepare("DELETE FROM api_tokens WHERE kind = 'run' AND run_id = ?").run(runId).changes;
}

// Housekeeping: drop expired run tokens (called from the executor's reap pass).
export function pruneExpiredTokens(db: DB, now = new Date()): number {
  return db.prepare("DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at < ?").run(now.toISOString()).changes;
}
