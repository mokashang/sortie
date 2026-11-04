import { execFile } from "child_process";
import type { DB } from "@/lib/db";
import { getAiProvider } from "@/ai/config";
import { agentProcessEnv } from "@/lib/agent-env";
import { resolveClaudeBin } from "@/lib/claude-bin";

// Is the Claude CLI on this box signed in? On 2026-11-02 at 22:15 it stopped being: the dispatcher
// spawned a session for task #670, the session sat at its prompt showing "Login expired", and the
// run stayed queued for 18 hours with a reminder typed into that terminal every couple of minutes.
// An interactive CLI with no login does not exit, so the early-exit guard in attended.ts never saw
// it, and nobody was told. The dispatcher now reads the answer here (attended.ts) and holds its
// queue, and tells the user once, until the CLI is signed in again.
//
// `claude auth status` is the authority: it reads the stored login (0.3 s, no network) and is the
// only way to learn the user has signed back in. It runs in the background, every few minutes, and
// sooner when something suggests it changed — a session's terminal or a headless run's log showing
// the CLI's own message (showsSignedOut), both of which call requestCliLoginCheck. The tick stays
// synchronous and only reads the last answer. This reads the state and never touches it: signing
// in is the user's to do.

// How often the CLI is asked while all looks well, and while waiting for the user to sign in.
export const LOGIN_CHECK_MS = 5 * 60 * 1000;
export const LOGIN_RECHECK_MS = 60 * 1000;
const LOGIN_CHECK_TIMEOUT_MS = 15_000;

export interface CliLogin {
  // null: the answer could not be read (the command failed, or a CLI update changed its output).
  signedIn: boolean | null;
  // When the last answer came back (ms); null until the first one since this server started.
  at: number | null;
}

type State = { login: CliLogin; askedAt: number | null; inFlight: boolean; wanted: boolean };
const g = globalThis as unknown as { __sortieCliLogin?: State };
// On globalThis like the terminal registry: Next bundles each route separately, and the tick, the
// run that fails and the terminal that shows the message must all share one answer.
function state(): State {
  return (g.__sortieCliLogin ??= { login: { signedIn: null, at: null }, askedAt: null, inFlight: false, wanted: false });
}

export function currentCliLogin(): CliLogin {
  return state().login;
}
// Ask again on the next tick instead of waiting for the regular check.
export function requestCliLoginCheck(): void {
  state().wanted = true;
}
// Tests only.
export function resetCliLogin(): void {
  delete g.__sortieCliLogin;
}

// Signed out, the command exits 1 and still prints the JSON, so the exit code says nothing here.
export function parseLoginStatus(stdout: string): boolean | null {
  try {
    const loggedIn = (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn;
    return typeof loggedIn === "boolean" ? loggedIn : null;
  } catch {
    return null;
  }
}

export type LoginStatusRunner = (bin: string, done: (stdout: string) => void) => void;

const runLoginStatus: LoginStatusRunner = (bin, done) => {
  // windowsHide: the server has no console, so each run would otherwise flash a blank window. The
  // environment is the one a spawned session gets, so the answer is about that session's login.
  execFile(
    bin,
    ["auth", "status"],
    { timeout: LOGIN_CHECK_TIMEOUT_MS, windowsHide: true, env: agentProcessEnv(process.env) as NodeJS.ProcessEnv },
    (_err, stdout) => done(String(stdout ?? ""))
  );
};

// Called on every dispatcher tick; starts a check only when one is due. The answer is there for the
// next tick. Only the Claude provider has this login (Codex and GPT sign in their own ways).
export function refreshCliLogin(db: DB, deps: { now?: () => number; run?: LoginStatusRunner; bin?: string } = {}): void {
  if (getAiProvider(db) !== "claude") return;
  const s = state();
  const now = deps.now ?? Date.now;
  const every = s.login.signedIn === false ? LOGIN_RECHECK_MS : LOGIN_CHECK_MS;
  if (s.inFlight || !(s.wanted || s.askedAt == null || now() - s.askedAt >= every)) return;
  s.inFlight = true;
  s.wanted = false;
  s.askedAt = now();
  (deps.run ?? runLoginStatus)(deps.bin ?? resolveClaudeBin(), (stdout) => {
    s.inFlight = false;
    s.login = { signedIn: parseLoginStatus(stdout), at: now() };
  });
}

// What the CLI says when it has no usable login, seen on 2026-11-03 and with an empty config dir:
// "Login expired · Please run /login" (interactive), "Not logged in · Please run /login" (claude -p),
// "Failed to authenticate: OAuth session expired and could not be refreshed" (claude -p). Matched
// narrowly: the attended prompt, which the terminal echoes, itself says "run claude /login".
const SIGNED_OUT_TEXT = /Please\s+run\s+\/login|Failed\s+to\s+authenticate[:.]|OAuth\s+session\s+expired/;

export function showsSignedOut(text: string): boolean {
  return SIGNED_OUT_TEXT.test(text);
}

// A headless run that failed because of this leaves the CLI's message as the last line of its log
// (runs #672-681, 2026-11-03: failed with an empty summary, nothing saying why). Only the last line
// counts, so a page or a step that merely mentions logging in cannot be taken for it.
export function signedOutSummary(lastLine: string | undefined): string | null {
  const line = lastLine?.trim();
  if (!line || !showsSignedOut(line)) return null;
  return `the AI provider is signed out on this computer, sign in again in a terminal here (${line})`;
}
