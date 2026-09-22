import { describe, it, expect } from "vitest";
import { authorizeUrl, emailFromIdToken, exchangeCode, signState, verifyState, STATE_TTL_MS, CONNECT_SCOPES, ConnectError } from "@/inbox/oauth";
import { GMAIL_SCOPE } from "@/inbox/scope";

const SECRET = "s".repeat(32);
const idToken = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("inbox/oauth state", () => {
  it("round-trips the account id and rejects forged, foreign-secret and expired states", () => {
    const t0 = 1_758_400_000_000;
    const state = signState(SECRET, "user-1", t0);
    expect(verifyState(SECRET, state, t0 + 1000)).toBe("user-1");
    expect(verifyState("x".repeat(32), state, t0 + 1000)).toBeNull();
    expect(verifyState(SECRET, state.slice(0, -2) + "zz", t0 + 1000)).toBeNull();
    expect(verifyState(SECRET, state, t0 + STATE_TTL_MS + 1)).toBeNull();
    expect(verifyState(SECRET, null)).toBeNull();
    expect(verifyState(SECRET, "nodot")).toBeNull();
    const [body] = state.split(".");
    expect(verifyState(SECRET, `${body}.`)).toBeNull();
  });
});

describe("inbox/oauth authorizeUrl", () => {
  it("asks for offline access, a fresh consent, account choice and the three scopes", () => {
    const u = new URL(authorizeUrl({ clientId: "cid", redirectUri: "https://x.example/api/inbox/google/callback", state: "st", loginHint: "me@example.com" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe(CONNECT_SCOPES.join(" "));
    expect(u.searchParams.get("scope")).toContain(GMAIL_SCOPE);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent select_account");
    expect(u.searchParams.get("include_granted_scopes")).toBe("false");
    expect(u.searchParams.get("redirect_uri")).toBe("https://x.example/api/inbox/google/callback");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("login_hint")).toBe("me@example.com");
    expect(u.searchParams.get("response_type")).toBe("code");
  });
});

describe("inbox/oauth exchangeCode", () => {
  const opts = { clientId: "cid", clientSecret: "sec", redirectUri: "https://x.example/cb" };

  it("posts the authorization code and reads the refresh token, scope and mailbox address", async () => {
    let body = "";
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", scope: `openid ${GMAIL_SCOPE} https://www.googleapis.com/auth/userinfo.email`, id_token: idToken({ email: "MJ@Example.com" }) }), { status: 200 });
    }) as typeof fetch;
    expect(await exchangeCode("the-code", { ...opts, fetcher })).toEqual({ refreshToken: "rt", scope: expect.stringContaining(GMAIL_SCOPE), email: "mj@example.com" });
    expect(body).toContain("code=the-code");
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("redirect_uri=https%3A%2F%2Fx.example%2Fcb");
  });

  it("names what went wrong: no gmail scope, no refresh token, no email, or a refused exchange", async () => {
    const respond = (json: object, status = 200) => (async () => new Response(JSON.stringify(json), { status })) as typeof fetch;
    await expect(exchangeCode("c", { ...opts, fetcher: respond({ refresh_token: "rt", scope: "openid email", id_token: idToken({ email: "a@b.c" }) }) })).rejects.toMatchObject({ code: "no_scope" });
    await expect(exchangeCode("c", { ...opts, fetcher: respond({ scope: GMAIL_SCOPE, id_token: idToken({ email: "a@b.c" }) }) })).rejects.toMatchObject({ code: "no_refresh_token" });
    await expect(exchangeCode("c", { ...opts, fetcher: respond({ refresh_token: "rt", scope: GMAIL_SCOPE }) })).rejects.toMatchObject({ code: "no_email" });
    const err = await exchangeCode("c", { ...opts, fetcher: respond({ error: "invalid_grant", error_description: "Bad Request" }, 400) }).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect(err.code).toBe("exchange");
    expect(err.message).toContain("invalid_grant");
  });

  it("emailFromIdToken tolerates garbage", () => {
    expect(emailFromIdToken(undefined)).toBeNull();
    expect(emailFromIdToken("not-a-jwt")).toBeNull();
    expect(emailFromIdToken("a.!!!.c")).toBeNull();
    expect(emailFromIdToken(idToken({ sub: "1" }))).toBeNull();
    expect(emailFromIdToken(idToken({ email: "X@Y.Z" }))).toBe("x@y.z");
  });
});
