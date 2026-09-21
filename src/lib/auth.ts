import crypto from "crypto";
import fs from "fs";
import path from "path";
import { betterAuth } from "better-auth";
import { getDb } from "@/lib/db";
import { onUserCreated, purgeUserData } from "@/lib/users";
import { mailerConfigured, sendMail, verificationMail, resetPasswordMail, changeEmailMail, deleteAccountMail } from "@/lib/mailer";
import { langFromCookieHeader, type Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";
import { serverLang } from "@/lib/prefs";

// Better Auth configuration (spec 2026-09-13 accounts §1). One instance per process, created
// lazily on first use so importing this module never opens the database (Next evaluates route
// modules while building).
//
// - email + password (scrypt), verification + reset by mail; verification is only REQUIRED when
//   a mailer is configured, otherwise the link lands in data/outbox and the account works unverified
// - Google when GOOGLE_CLIENT_ID/SECRET are set; same-email accounts link automatically
// - httpOnly session cookie, 30 days, 5-minute cookie cache (the shell polls every 5 s)
// - the first sign-up becomes the box's owner and claims the pre-accounts data (users.ts)

export const SESSION_TTL_S = 30 * 24 * 60 * 60;

// The language an account mail is written in: the sortie.lang cookie of the request that asked
// for it (sign-up, reset, email change, deletion), else the saved preference.
function mailLang(request?: Request): Lang {
  return langFromCookieHeader(request?.headers.get("cookie")) ?? serverLang();
}

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

// BETTER_AUTH_SECRET when set; otherwise a secret generated once into data/auth-secret so sessions
// survive restarts without the operator having to think about it.
export function authSecret(): string {
  const fromEnv = process.env.BETTER_AUTH_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir(), "auth-secret");
  try {
    const s = fs.readFileSync(file, "utf8").trim();
    if (s.length >= 32) return s;
  } catch {
    /* generate below */
  }
  const fresh = crypto.randomBytes(32).toString("base64url");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${fresh}\n`, { mode: 0o600 });
  return fresh;
}

// Where the app is reached from the browser: BETTER_AUTH_URL, else the custom domain, else the
// local dev origin. OAuth redirect URIs and mail links are built from this.
export function authBaseUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.BETTER_AUTH_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const domain = env.SORTIE_DOMAIN?.trim();
  if (domain) return `https://${domain}`;
  return `http://127.0.0.1:${env.PORT || "3000"}`;
}

// Every origin the UI is served from (the app is reachable by several names on the tailnet).
export function trustedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const port = env.PORT || "3000";
  const set = new Set<string>([authBaseUrl(env), `http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  if (env.SORTIE_DOMAIN?.trim()) set.add(`https://${env.SORTIE_DOMAIN.trim()}`);
  if (env.TS_HOSTNAME?.trim()) set.add(`https://${env.TS_HOSTNAME.trim()}`);
  for (const extra of (env.AUTH_TRUSTED_ORIGINS ?? "").split(",")) if (extra.trim()) set.add(extra.trim());
  return [...set];
}

export function googleConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

export function signupDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.SIGNUP_DISABLED?.trim());
}

// Public, non-secret facts the auth pages need.
export interface AuthPublicConfig {
  googleEnabled: boolean;
  signupOpen: boolean;
  emailVerificationRequired: boolean;
  mailerConfigured: boolean;
}
export function authPublicConfig(): AuthPublicConfig {
  return {
    googleEnabled: googleConfigured(),
    signupOpen: !signupDisabled(),
    emailVerificationRequired: mailerConfigured(),
    mailerConfigured: mailerConfigured(),
  };
}

export function buildAuth() {
  const env = process.env;
  const google = googleConfigured(env)
    ? { google: { clientId: env.GOOGLE_CLIENT_ID as string, clientSecret: env.GOOGLE_CLIENT_SECRET as string } }
    : {};
  return betterAuth({
    appName: "Sortie",
    baseURL: authBaseUrl(env),
    secret: authSecret(),
    database: getDb(),
    trustedOrigins: trustedOrigins(env),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      disableSignUp: signupDisabled(env),
      requireEmailVerification: mailerConfigured(env),
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }, request) => {
        await sendMail(resetPasswordMail(user.email, user.name, url, mailLang(request)));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }, request) => {
        await sendMail(verificationMail(user.email, user.name, url, mailLang(request)));
      },
    },
    socialProviders: google,
    account: {
      // Google is trusted, so a Google sign-in with the same email links to the existing
      // password account. Better Auth 1.7 additionally insists the LOCAL email be verified before
      // linking; without a mailer nobody's local email ever gets verified (verification is not
      // required then), so that check is waived — Google itself vouches for the address. With a
      // mailer the check stays on: an unverified local account cannot be entered via Google.
      accountLinking: { enabled: true, trustedProviders: ["google"], requireLocalEmailVerified: mailerConfigured() },
    },
    session: {
      expiresIn: SESSION_TTL_S,
      updateAge: 24 * 60 * 60,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "member", input: false },
      },
      validateUserInfo: async ({ source }) => {
        if (source.action === "create-user" && signupDisabled(env)) {
          return { error: "signup_disabled", errorDescription: messages[serverLang()].errors.signupDisabled };
        }
      },
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }, request) => {
          await sendMail(changeEmailMail(user.email, user.name, newEmail, url, mailLang(request)));
        },
      },
      deleteUser: {
        enabled: true,
        // With a mailer the deletion is confirmed by mail; without one Better Auth deletes
        // straight away (the UI still asks for the password / a fresh session first).
        ...(mailerConfigured(env)
          ? {
              sendDeleteAccountVerification: async ({ user, url }: { user: { email: string; name: string }; url: string }, request?: Request) => {
                await sendMail(deleteAccountMail(user.email, user.name, url, mailLang(request)));
              },
            }
          : {}),
        afterDelete: async (user) => {
          purgeUserData(getDb(), user.id);
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const r = onUserCreated(getDb(), { id: user.id, email: user.email }, { ownerEmail: env.SORTIE_OWNER_EMAIL ?? null });
            console.log(
              `[auth] user ${user.email} created${r.becameOwner ? " — became owner" : ""}${r.claimed ? `, claimed legacy rows ${JSON.stringify(r.claimed.rows)}` : ""}, backfilled ${r.backfilled} applications`
            );
          },
        },
      },
    },
    rateLimit: {
      // Explicit so behaviour does not flip with NODE_ENV; the auth routes are the only ones a
      // stranger on the tailnet can hit without a session.
      enabled: true,
      window: 60,
      max: 60,
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
      cookiePrefix: "sortie",
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;

const g = globalThis as unknown as { __sortieAuth?: Auth };
export function getAuth(): Auth {
  return (g.__sortieAuth ??= buildAuth());
}
