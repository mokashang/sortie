import fs from "fs";
import path from "path";

// The environment a spawned agent CLI (claude / codex) gets: minus the identity of whatever
// Claude Code session happened to start the server, and minus the server's own secrets.
//
// pm2 copies the calling shell's environment into the app on `pm2 start` and on
// `pm2 restart --update-env`, and deploys are usually run from a Claude Code session. On
// 2026-10-22 the server's environment carried that session's CLAUDECODE=1, its session id,
// its desktop messaging socket and token, CLAUDE_CODE_ENTRYPOINT=claude-desktop and so on:
// every assistant the dispatcher launched would have started as a nested child of an
// unrelated desktop session. Configuration a child legitimately needs stays.
const KEEP_CLAUDE_CODE = new Set([
  "CLAUDE_CODE_GIT_BASH_PATH",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_SKIP_BEDROCK_AUTH",
  "CLAUDE_CODE_SKIP_VERTEX_AUTH",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
  "CLAUDE_CODE_API_KEY_HELPER_TTL_MS",
]);

export function isParentSessionVar(key: string): boolean {
  if (key === "CLAUDECODE" || key === "CLAUDE_PID" || key === "AI_AGENT") return true;
  if (key.startsWith("CLAUDE_AGENT_SDK_")) return true;
  return key.startsWith("CLAUDE_CODE_") && !KEEP_CLAUDE_CODE.has(key);
}

export function withoutParentSession<T extends Record<string, string | undefined>>(env: T): T {
  const out = { ...env };
  for (const key of Object.keys(out)) if (isParentSessionVar(key)) delete out[key];
  return out;
}

// The server's configuration (.env, which Next loads into process.env) is the server's business:
// CF_API_TOKEN, GOOGLE_CLIENT_SECRET, NTFY_TOPIC and friends. An agent reading untrusted job pages
// with Bash(curl) allowed could otherwise be talked into expanding one into a URL. Agents need none
// of it — their API base and run token come in their prompt (security review 2026-10-22). Names that
// look like credentials are dropped wherever they came from, except what the agent CLIs authenticate
// with (ANTHROPIC_*, CLAUDE_CODE_OAUTH_TOKEN; OPENAI / CODEX keys are handled by their callers).
const ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"];
const SECRET_NAME = /(SECRET|PASSWORD|PASSWD|PRIVATE_KEY|_TOKEN|NTFY_TOPIC|SMTP_URL|CREDENTIALS?)$/i;
const CLI_AUTH = /^(ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|OPENAI_API_KEY$|CODEX_API_KEY$)/;

export function envFileKeys(dir: string = process.cwd()): Set<string> {
  const keys = new Set<string>();
  for (const f of ENV_FILES) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m) keys.add(m[1]);
    }
  }
  return keys;
}

export function withoutServerSecrets<T extends Record<string, string | undefined>>(env: T, serverKeys: Set<string> = envFileKeys()): T {
  const out = { ...env };
  for (const key of Object.keys(out)) {
    if (CLI_AUTH.test(key)) continue;
    if (serverKeys.has(key) || SECRET_NAME.test(key)) delete out[key];
  }
  return out;
}

// Both: what every spawned agent process starts with.
export function agentProcessEnv<T extends Record<string, string | undefined>>(env: T): T {
  return withoutServerSecrets(withoutParentSession(env));
}
