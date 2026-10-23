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

import fs from "fs";
import os from "os";
import path from "path";
import { withoutServerSecrets, envFileKeys } from "@/lib/agent-env";
describe("withoutServerSecrets", () => {
  it("drops everything the server's .env defines and anything named like a credential, keeps CLI auth", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sortie-envkeys-"));
    fs.writeFileSync(path.join(dir, ".env"), "NTFY_TOPIC=x\r\nCF_API_TOKEN=y\n# comment=no\nexport CHROME_BIN=z\nTECTONIC_BIN=t\n");
    const keys = envFileKeys(dir);
    expect([...keys].sort()).toEqual(["CF_API_TOKEN", "CHROME_BIN", "NTFY_TOPIC", "TECTONIC_BIN"]);
    const out = withoutServerSecrets(
      {
        PATH: "p",
        USERPROFILE: "u",
        NTFY_TOPIC: "x",
        CF_API_TOKEN: "y",
        TECTONIC_BIN: "t",
        GOOGLE_CLIENT_SECRET: "s",
        GITHUB_TOKEN: "g",
        SMTP_URL: "smtp://u:p@h",
        ANTHROPIC_API_KEY: "a",
        CLAUDE_CODE_OAUTH_TOKEN: "o",
      },
      keys
    );
    expect(out).toEqual({ PATH: "p", USERPROFILE: "u", ANTHROPIC_API_KEY: "a", CLAUDE_CODE_OAUTH_TOKEN: "o" });
  });
});
