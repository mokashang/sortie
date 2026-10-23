import { describe, it, expect } from "vitest";
import { withoutParentSession } from "@/lib/agent-env";

describe("withoutParentSession", () => {
  it("drops the identity of the Claude Code session that started the server, keeps the rest", () => {
    const env = {
      PATH: "C:\Windows",
      CLAUDE_BIN: "C:\Users\S\.local\bin\claude.exe",
      CLAUDECODE: "1",
      CLAUDE_PID: "16124",
      AI_AGENT: "claude-code",
      CLAUDE_AGENT_SDK_VERSION: "0.3.304",
      CLAUDE_CODE_SESSION_ID: "d904f796",
      CLAUDE_CODE_MESSAGING_SOCKET: "\\.\pipe\LOCAL\cc-msg",
      CLAUDE_CODE_MESSAGING_TOKEN: "secret",
      CLAUDE_CODE_ENTRYPOINT: "claude-desktop",
      CLAUDE_CODE_GIT_BASH_PATH: "C:\Program Files\Git\bin\bash.exe",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    };
    expect(withoutParentSession(env)).toEqual({
      PATH: "C:\Windows",
      CLAUDE_BIN: "C:\Users\S\.local\bin\claude.exe",
      CLAUDE_CODE_GIT_BASH_PATH: "C:\Program Files\Git\bin\bash.exe",
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
    });
    expect(env.CLAUDECODE).toBe("1"); // the input is not modified
  });
});
