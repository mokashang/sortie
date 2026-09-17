import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { openDb } from "@/lib/db";
import { getActor, withUser, withInternal, requireOwner, AuthError } from "@/lib/actor";
import { getInternalToken, isInternalToken, resetInternalTokenCacheForTests, internalTokenPath } from "@/lib/internal-token";
import { createToken, createRunToken, verifyToken, listPersonalTokens, revokeToken, revokeRunTokens, hashToken, TOKEN_PREFIX } from "@/lib/api-tokens";
import { seedUser } from "./helpers";

// Bearer-token principals (spec 2026-09-13 accounts §2). Cookie sessions go through Better Auth
// and are exercised against the running app, not here.

let dataDir: string;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-actor-"));
  process.env.DATA_DIR = dataDir;
  delete process.env.SORTIE_INTERNAL_TOKEN;
  resetInternalTokenCacheForTests();
});
afterEach(() => {
  delete process.env.DATA_DIR;
  resetInternalTokenCacheForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function req(url: string, token?: string): Request {
  return new Request(`http://127.0.0.1:3000${url}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
}

describe("internal token", () => {
  it("is generated once into data/internal-token and compared in constant time", () => {
    const t = getInternalToken();
    expect(t.startsWith("sortie_internal_")).toBe(true);
    expect(fs.readFileSync(internalTokenPath(), "utf8").trim()).toBe(t);
    resetInternalTokenCacheForTests();
    expect(getInternalToken()).toBe(t); // read back, not regenerated
    expect(isInternalToken(t)).toBe(true);
    expect(isInternalToken(t + "x")).toBe(false);
    expect(isInternalToken("")).toBe(false);
  });

  it("SORTIE_INTERNAL_TOKEN wins over the file", () => {
    process.env.SORTIE_INTERNAL_TOKEN = "sortie_internal_fromenv_0123456789abcdef";
    resetInternalTokenCacheForTests();
    expect(getInternalToken()).toBe("sortie_internal_fromenv_0123456789abcdef");
    expect(fs.readFileSync(internalTokenPath(), "utf8").trim()).toBe("sortie_internal_fromenv_0123456789abcdef");
    delete process.env.SORTIE_INTERNAL_TOKEN;
  });
});

describe("api tokens", () => {
  it("mints, verifies, lists and revokes personal tokens; run tokens expire and die with the run", () => {
    const db = openDb(":memory:");
    seedUser(db, "u1", "u1@example.com");
    const { token, row } = createToken(db, { userId: "u1", name: "MacBook" });
    expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(row.prefix).toBe(token.slice(0, TOKEN_PREFIX.length + 6));
    expect(verifyToken(db, token)?.userId).toBe("u1");
    expect(verifyToken(db, "sortie_nope_nope_nope_nope_nope_nope")).toBeNull();
    expect(verifyToken(db, "plain")).toBeNull();
    expect(db.prepare("SELECT token_hash FROM api_tokens WHERE id = ?").get(row.id)).toEqual({ token_hash: hashToken(token) });
    expect(listPersonalTokens(db, "u1").map((t) => t.name)).toEqual(["MacBook"]);
    expect(listPersonalTokens(db, "u2")).toEqual([]);
    expect(revokeToken(db, "u2", row.id)).toBe(false);
    expect(revokeToken(db, "u1", row.id)).toBe(true);
    expect(verifyToken(db, token)).toBeNull();

    const rt = createRunToken(db, "u1", 42, new Date("2026-09-13T00:00:00Z"));
    expect(verifyToken(db, rt, new Date("2026-09-13T12:00:00Z"))).toMatchObject({ kind: "run", runId: 42, userId: "u1" });
    expect(verifyToken(db, rt, new Date("2026-09-19T00:00:00Z"))).not.toBeNull(); // 6 days: still good (RUN_TOKEN_TTL_MS is 7 days)
    expect(verifyToken(db, rt, new Date("2026-09-21T00:00:00Z"))).toBeNull(); // expired
    expect(listPersonalTokens(db, "u1")).toEqual([]); // run tokens are never listed
    expect(revokeRunTokens(db, 42)).toBe(1);
  });
});

describe("getActor / withUser / withInternal", () => {
  it("resolves personal and run tokens to their account, and the internal token to the owner", async () => {
    const db = openDb(":memory:");
    seedUser(db, "own", "own@example.com", { role: "owner" });
    seedUser(db, "u2", "u2@example.com");
    const personal = createToken(db, { userId: "u2", name: "t" }).token;
    const run = createRunToken(db, "own", 7);
    expect(await getActor(req("/api/x", personal), db)).toMatchObject({ userId: "u2", via: "token", runId: null });
    expect(await getActor(req("/api/x", run), db)).toMatchObject({ userId: "own", via: "run", runId: 7 });
    expect(await getActor(req("/api/x", getInternalToken()), db)).toMatchObject({ userId: "own", via: "internal" });
    expect(await getActor(req("/api/x", "sortie_garbage_garbage_garbage_garbage"), db)).toBeNull();
  });

  it("the internal token resolves to nobody until an owner exists", async () => {
    const db = openDb(":memory:");
    expect(await getActor(req("/api/x", getInternalToken()), db)).toBeNull();
  });

  it("withUser answers 401 with no credential and passes the actor through otherwise", async () => {
    const db = openDb(":memory:");
    seedUser(db, "u1", "u1@example.com");
    const token = createToken(db, { userId: "u1", name: "t" }).token;
    const handler = withUser(async (_req, actor) => Response.json({ who: actor.userId, via: actor.via }));
    // withUser uses the process-wide db; point it at this one.
    (globalThis as { __jsdb?: unknown }).__jsdb = db;
    try {
      const denied = await handler(req("/api/x"), { params: Promise.resolve({}) });
      expect(denied.status).toBe(401);
      expect(await denied.json()).toMatchObject({ code: "unauthenticated" });
      const ok = await handler(req("/api/x", token), { params: Promise.resolve({}) });
      expect(await ok.json()).toEqual({ who: "u1", via: "token" });
      const forbidden = withUser(async (_r, actor) => {
        requireOwner(actor);
        return Response.json({ ok: true });
      });
      const r = await forbidden(req("/api/x", token), { params: Promise.resolve({}) });
      expect(r.status).toBe(403);
    } finally {
      delete (globalThis as { __jsdb?: unknown }).__jsdb;
    }
  });

  it("withInternal accepts the internal token and refuses personal tokens", async () => {
    const db = openDb(":memory:");
    seedUser(db, "u1", "u1@example.com");
    const token = createToken(db, { userId: "u1", name: "t" }).token;
    const handler = withInternal(async () => Response.json({ ok: true }));
    (globalThis as { __jsdb?: unknown }).__jsdb = db;
    try {
      expect((await handler(req("/api/scan/tick", getInternalToken()), { params: Promise.resolve({}) })).status).toBe(200);
      expect((await handler(req("/api/scan/tick", token), { params: Promise.resolve({}) })).status).toBe(403);
      expect((await handler(req("/api/scan/tick"), { params: Promise.resolve({}) })).status).toBe(401);
    } finally {
      delete (globalThis as { __jsdb?: unknown }).__jsdb;
    }
    expect(new AuthError().status).toBe(401);
  });
});
