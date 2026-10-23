import { describe, expect, it } from "vitest";
import { attendedSettingsPath, buildAttendedAgentLaunch, buildHeadlessAgentLaunch } from "@/ai/runtime";

const playwright = { command: "cmd", args: ["/c", "npx", "@playwright/mcp", "--headless"] };

describe("AI agent runtime", () => {
  it("uses saved Codex auth and inline Playwright for Codex headless work", () => {
    const launch = buildHeadlessAgentLaunch({
      provider: "codex",
      prompt: "P",
      cwd: "C:\\sortie",
      playwright,
      env: { CODEX_BIN: "C:\\codex.exe", CODEX_AGENT_MODEL: "codex-model" },
    });
    expect(launch.bin).toBe("C:\\codex.exe");
    expect(launch.args.slice(0, 2)).toEqual(["exec", "--ephemeral"]);
    expect(launch.args).toContain("--strict-config");
    expect(launch.args.join(" ")).toContain("mcp_servers.playwright.command");
    expect(launch.args.join(" ")).toContain("shell_environment_policy.filters.CODEX_API_KEY");
    expect(launch.args).toContain("codex-model");
    expect(launch.env.CODEX_API_KEY).toBeUndefined();
    expect(launch.env.OPENAI_API_KEY).toBeUndefined();
  });

  it("uses CODEX_API_KEY only in the GPT agent child", () => {
    const env = { CODEX_BIN: "codex", OPENAI_API_KEY: "sk-gpt", OPENAI_MODEL: "gpt-model" };
    const launch = buildAttendedAgentLaunch({ provider: "gpt", prompt: "P", runId: 7, cwd: "C:\\sortie", env });
    expect(launch.bin).toBe("codex");
    expect(launch.args.slice(0, 2)).toEqual(["exec", "--ephemeral"]);
    expect(launch.args).toContain("--strict-config");
    expect(launch.args).toContain("gpt-model");
    expect(launch.env.CODEX_API_KEY).toBe("sk-gpt");
    expect(launch.env.OPENAI_API_KEY).toBeUndefined();
    expect(launch.args.join(" ")).toContain("shell_environment_policy.filters.OPENAI_API_KEY");
    expect(env).not.toHaveProperty("CODEX_API_KEY");
  });

  it("an attended Claude session loads the user's own attended-settings file only when it exists", () => {
    const env = { CLAUDE_BIN: "/claude", ATTENDED_CLAUDE_BIN: "/claude" };
    const withFile = buildAttendedAgentLaunch({ provider: "claude", prompt: "P", runId: 7, cwd: "/sortie", env, settingsPath: "/data/attended-settings.json" });
    const i = withFile.args.indexOf("--settings");
    expect(withFile.args[i + 1]).toBe("/data/attended-settings.json");
    expect(i).toBeLessThan(withFile.args.indexOf("--allowedTools"));
    expect(withFile.args).toContain("dontAsk");
    const without = buildAttendedAgentLaunch({ provider: "claude", prompt: "P", runId: 7, cwd: "/sortie", env, settingsPath: null });
    expect(without.args).not.toContain("--settings");
    expect(attendedSettingsPath({ ATTENDED_CLAUDE_SETTINGS: "/x.json" }, () => false)).toBeNull();
    expect(attendedSettingsPath({ ATTENDED_CLAUDE_SETTINGS: "/x.json" }, () => true)).toBe("/x.json");
  });

  it("retains the old Claude launcher as a compatibility path", () => {
    const launch = buildHeadlessAgentLaunch({ provider: "claude", prompt: "P", cwd: "/sortie", playwright, env: { CLAUDE_BIN: "/claude" } });
    expect(launch.bin.toLowerCase()).toContain("claude");
    expect(launch.args).toContain("--mcp-config");
    expect(launch.args).toContain("--strict-mcp-config");
  });
});
