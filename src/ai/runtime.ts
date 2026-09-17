import type { AiProvider, EnvMap } from "@/ai/config";
import { assertProviderConfigured } from "@/ai/config";
import { resolveClaudeBin } from "@/lib/claude-bin";
import { resolveCodexBin } from "@/lib/codex-bin";
import type { McpServerSpec } from "@/executor/mcp-config";

export interface AgentLaunch {
  bin: string;
  args: string[];
  env: EnvMap;
}

function toml(value: string | string[]): string {
  return JSON.stringify(value);
}

function codexMcpArgs(server: McpServerSpec): string[] {
  return [
    "--config",
    `mcp_servers.playwright.command=${toml(server.command)}`,
    "--config",
    `mcp_servers.playwright.args=${toml(server.args)}`,
    "--config",
    "mcp_servers.playwright.required=true",
  ];
}

const CODEX_SECRET_FILTER_ARGS = [
  "--config",
  "shell_environment_policy.ignore_default_excludes=false",
  "--config",
  "shell_environment_policy.filters.CODEX_API_KEY=\"exclude\"",
  "--config",
  "shell_environment_policy.filters.OPENAI_API_KEY=\"exclude\"",
];

function agentEnv(provider: AiProvider, env: EnvMap): EnvMap {
  const childEnv = { ...env };
  delete childEnv.OPENAI_API_KEY;
  delete childEnv.CODEX_API_KEY;
  if (provider !== "gpt") return childEnv;
  // Official Codex automation auth: CODEX_API_KEY affects this invocation only and avoids
  // replacing the user's saved ChatGPT/Codex login.
  childEnv.CODEX_API_KEY = env.OPENAI_API_KEY;
  return childEnv;
}

function codexModel(provider: AiProvider, env: EnvMap): string | undefined {
  return provider === "gpt" ? env.GPT_AGENT_MODEL || env.OPENAI_SMART_MODEL || env.OPENAI_MODEL : env.CODEX_AGENT_MODEL;
}

export interface HeadlessLaunchOptions {
  provider: AiProvider;
  prompt: string;
  cwd: string;
  playwright: McpServerSpec;
  env?: EnvMap;
}

export function buildHeadlessAgentLaunch(opts: HeadlessLaunchOptions): AgentLaunch {
  const env = opts.env ?? process.env;
  assertProviderConfigured(opts.provider, env);
  if (opts.provider === "claude") {
    return {
      bin: resolveClaudeBin({ env }),
      args: [
        "-p",
        "--output-format",
        "text",
        "--no-session-persistence",
        "--model",
        env.CLAUDE_AGENT_MODEL || "claude-sonnet-5",
        "--allowedTools",
        "Bash(curl:*),mcp__playwright__*",
        "--mcp-config",
        JSON.stringify({ mcpServers: { playwright: opts.playwright } }),
        "--strict-mcp-config",
      ],
      env: agentEnv(opts.provider, env),
    };
  }

  const args = [
    "exec",
    "--ephemeral",
    "--strict-config",
    "--sandbox",
    "workspace-write",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--cd",
    opts.cwd,
    "--config",
    "approval_policy=\"never\"",
    "--config",
    "sandbox_workspace_write.network_access=true",
    ...CODEX_SECRET_FILTER_ARGS,
    ...codexMcpArgs(opts.playwright),
  ];
  const model = codexModel(opts.provider, env);
  if (model) args.push("--model", model);
  args.push("-");
  return { bin: resolveCodexBin({ env }), args, env: agentEnv(opts.provider, env) };
}

export interface AttendedLaunchOptions {
  provider: AiProvider;
  prompt: string;
  runId: number;
  cwd: string;
  sessionName?: string;
  env?: EnvMap;
}

export function buildAttendedAgentLaunch(opts: AttendedLaunchOptions): AgentLaunch {
  const env = opts.env ?? process.env;
  assertProviderConfigured(opts.provider, env);
  if (opts.provider === "claude") {
    return {
      bin: env.ATTENDED_CLAUDE_BIN || resolveClaudeBin({ env }),
      args: [
        "--chrome",
        "--permission-mode",
        "dontAsk",
        "--allowedTools",
        "mcp__claude-in-chrome__*",
        "ToolSearch",
        "Skill",
        "Read",
        "Bash(curl:*)",
        "Bash(jq:*)",
        "Bash(sleep:*)",
        "Bash(date:*)",
        "Bash(cat:*)",
        "-n",
        opts.sessionName ?? `sortie-run-${opts.runId}`,
        opts.prompt,
      ],
      env: agentEnv(opts.provider, env),
    };
  }

  const args = [
    "exec",
    "--ephemeral",
    "--strict-config",
    "--sandbox",
    "workspace-write",
    "--cd",
    opts.cwd,
    "--config",
    "approval_policy=\"never\"",
    "--config",
    "sandbox_workspace_write.network_access=true",
    ...CODEX_SECRET_FILTER_ARGS,
  ];
  const model = codexModel(opts.provider, env);
  if (model) args.push("--model", model);
  args.push(opts.prompt);
  return { bin: env.ATTENDED_CODEX_BIN || resolveCodexBin({ env }), args, env: agentEnv(opts.provider, env) };
}
