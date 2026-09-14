import { NextResponse } from "next/server";
import { getDb, type DB } from "@/lib/db";
import { getAuth } from "@/lib/auth";
import { isInternalToken } from "@/lib/internal-token";
import { verifyToken } from "@/lib/api-tokens";
import { getUser, ownerId, type UserRow } from "@/lib/users";
import { ProfileIncompleteError } from "@/lib/profile";
import type { Lang } from "@/i18n/lang";
import { langFromCookieHeader } from "@/i18n/lang";
import { messages } from "@/i18n/messages";
import { serverLang } from "@/lib/prefs";

// Who is calling an API route (spec 2026-09-13 accounts §2). Three principals resolve to an
// account:
//   session  — the browser's Better Auth cookie
//   token    — a personal token (Authorization: Bearer sortie_…) or a run token minted for one
//              executor run (`via: "run"`)
//   internal — the box's own token (data/internal-token / SORTIE_INTERNAL_TOKEN), which acts as
//              the OWNER account; with no owner yet it can only reach internal-only routes
// Every tenant-scoped handler goes through withUser() and reads actor.userId; nothing else may
// decide whose data a request touches.

export type ActorVia = "session" | "token" | "run" | "internal";

export interface Actor {
  userId: string;
  via: ActorVia;
  runId: number | null;
  user: UserRow | null;
}

// `kind` picks the message shown to the user in their language (src/i18n/messages/errors.ts);
// the English message on the Error itself is for logs.
export type AuthErrorKind = "signIn" | "ownerOnly";
export class AuthError extends Error {
  status: number;
  kind: AuthErrorKind;
  constructor(kind: AuthErrorKind = "signIn", status = 401) {
    super(kind === "ownerOnly" ? "only the owner account may do this" : "sign in first");
    this.name = "AuthError";
    this.status = status;
    this.kind = kind;
  }
}

// The language for a response: the request's sortie.lang cookie, else the saved preference.
export function requestLang(req?: Request | null): Lang {
  return (req ? langFromCookieHeader(req.headers.get("cookie")) : null) ?? serverLang();
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// True when the request presents the box's internal token (whatever routes it is on).
export function isInternalRequest(req: Request): boolean {
  const t = bearer(req);
  return !!t && isInternalToken(t);
}

export async function getActor(req: Request, db: DB = getDb()): Promise<Actor | null> {
  const t = bearer(req);
  if (t) {
    if (isInternalToken(t)) {
      const owner = ownerId(db);
      if (!owner) return null;
      return { userId: owner, via: "internal", runId: null, user: getUser(db, owner) };
    }
    const row = verifyToken(db, t);
    if (!row) return null;
    return { userId: row.userId, via: row.kind === "run" ? "run" : "token", runId: row.runId, user: getUser(db, row.userId) };
  }
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user) return null;
  return { userId: session.user.id, via: "session", runId: null, user: getUser(db, session.user.id) };
}

export async function requireActor(req: Request, db: DB = getDb()): Promise<Actor> {
  const actor = await getActor(req, db);
  if (!actor) throw new AuthError();
  return actor;
}

export function errorResponse(e: unknown, lang: Lang = serverLang()): Response | null {
  const t = messages[lang].errors;
  if (e instanceof AuthError) {
    return NextResponse.json({ error: e.kind === "ownerOnly" ? t.ownerOnly : t.signInFirst, code: "unauthenticated" }, { status: e.status });
  }
  if (e instanceof ProfileIncompleteError) {
    return NextResponse.json({ error: t.profileIncomplete, code: "profile_incomplete", issues: e.issues }, { status: 409 });
  }
  return null;
}

// The 400-with-message shape every route used before accounts, with auth/profile errors mapped
// to their own codes first.
export function failResponse(e: unknown, status = 400, lang: Lang = serverLang()): Response {
  return errorResponse(e, lang) ?? NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status });
}

// Routes that change shared machine state (information sources) are the owner's to call.
export function requireOwner(actor: Actor): void {
  if (actor.user?.role !== "owner") throw new AuthError("ownerOnly", 403);
}

type RouteContext = { params: Promise<Record<string, string>> };
export type UserHandler = (req: Request, actor: Actor, ctx: RouteContext) => Promise<Response> | Response;

// Wraps a route handler: resolves the actor (401 when none), maps auth/profile errors, and hands
// the handler the account id every query must be scoped to.
export function withUser(handler: UserHandler): (req: Request, ctx: RouteContext) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const actor = await requireActor(req);
      return await handler(req, actor, ctx);
    } catch (e) {
      const mapped = errorResponse(e, requestLang(req));
      if (mapped) return mapped;
      throw e;
    }
  };
}

// Machine-only routes (scheduler ticks, the dispatcher): the internal token, or the owner's own
// session (so the owner can poke them from the browser while debugging).
export function withInternal(handler: (req: Request, ctx: RouteContext) => Promise<Response> | Response): (req: Request, ctx: RouteContext) => Promise<Response> {
  return async (req, ctx) => {
    if (isInternalRequest(req)) return handler(req, ctx);
    const actor = await getActor(req);
    if (actor?.via === "session" && actor.user?.role === "owner") return handler(req, ctx);
    return NextResponse.json({ error: "internal token required", code: "forbidden" }, { status: actor ? 403 : 401 });
  };
}
