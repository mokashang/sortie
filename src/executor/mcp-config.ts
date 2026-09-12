import path from "path";

// Headless `claude -p` executor sessions (apply / network_* / jd_review) get exactly ONE MCP
// server: the official Playwright MCP driving the dedicated persistent Chrome profile at
// data/browser-profile. It is registered inline on the command line (`--mcp-config <json>`), and
// `--strict-mcp-config` makes the child ignore every other MCP configuration on the machine
// (~/.claude.json user scope, project .mcp.json, …). Two reasons:
//  1. The App no longer depends on a hand-registered `claude mcp add playwright` entry on the
//     machine — the Windows box needs zero MCP setup, and the entry cannot drift out of sync.
//  2. The user's own interactive sessions no longer need a user-scope `playwright` entry that
//     points at this profile — that shared entry is what used to make a desktop session and a
//     running executor fight over one Chrome profile ("Browser is already in use").
// The scoring / dedup / referral-fit calls in src/llm/backends/subscription.ts pass
// `--strict-mcp-config` alone: no MCP servers at all. Each of those short-lived processes used to
// boot a Playwright MCP and a hanzi-browse server it never used (six at a time during a matching
// pass), inherited from the user-scope config.

export function browserProfileDir(cwd = process.cwd()): string {
  return path.join(cwd, "data", "browser-profile");
}

export interface McpServerSpec {
  command: string;
  args: string[];
}

// The executor's Chrome runs headless (no window) unless EXECUTOR_BROWSER_HEADED is set. On the
// always-on box the jd_review relay starts runs on its own, and a headed Playwright window popping
// up and changing pages on top of whatever the user is doing was the #1 complaint after the
// Windows cutover (2026-09-11). The persistent profile (cookies / logins) is shared either way;
// the settings-page "open the background browser, log in once" button still opens a real headed
// window because that one exists for the user to type into. Set EXECUTOR_BROWSER_HEADED=1 to
// watch a run or when a site refuses headless sessions.
export function executorBrowserHeaded(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.EXECUTOR_BROWSER_HEADED);
}

// On native Windows `npx` is a .cmd shim that a plain (shell-less) spawn cannot exec, so the
// server goes through `cmd /c` there — the documented pattern for npx-based MCP servers on Windows.
export function playwrightMcpServer(
  profileDir: string,
  platform: NodeJS.Platform = process.platform,
  headed: boolean = executorBrowserHeaded()
): McpServerSpec {
  const npx = ["npx", "-y", "@playwright/mcp@latest", "--browser", "chrome", "--user-data-dir", profileDir];
  if (!headed) npx.push("--headless");
  return platform === "win32" ? { command: "cmd", args: ["/c", ...npx] } : { command: npx[0], args: npx.slice(1) };
}

// The `--mcp-config` argument for a headless executor session: playwright, and nothing else.
export function playwrightMcpConfig(
  profileDir: string,
  platform: NodeJS.Platform = process.platform,
  headed: boolean = executorBrowserHeaded()
): string {
  return JSON.stringify({ mcpServers: { playwright: playwrightMcpServer(profileDir, platform, headed) } });
}
