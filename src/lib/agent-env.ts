// The environment a spawned agent CLI (claude / codex) gets, minus the identity of whatever
// Claude Code session happened to start the server.
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
