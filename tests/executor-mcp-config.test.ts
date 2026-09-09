import { describe, it, expect } from "vitest";
import path from "path";
import { browserProfileDir, playwrightMcpConfig, playwrightMcpServer } from "@/executor/mcp-config";

describe("executor mcp-config", () => {
  it("puts the dedicated Chrome profile at <cwd>/data/browser-profile", () => {
    expect(browserProfileDir("/srv/app")).toBe(path.join("/srv/app", "data", "browser-profile"));
    expect(browserProfileDir()).toBe(path.join(process.cwd(), "data", "browser-profile"));
  });

  it("spawns npx directly on POSIX and through cmd /c on native Windows", () => {
    expect(playwrightMcpServer("/p", "darwin")).toEqual({
      command: "npx",
      args: ["-y", "@playwright/mcp@latest", "--browser", "chrome", "--user-data-dir", "/p"],
    });
    expect(playwrightMcpServer("C:\\sortie\\data\\browser-profile", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "npx", "-y", "@playwright/mcp@latest", "--browser", "chrome", "--user-data-dir", "C:\\sortie\\data\\browser-profile"],
    });
  });

  it("serialises a --mcp-config string with playwright as the only server", () => {
    const cfg = JSON.parse(playwrightMcpConfig("/p", "linux")) as { mcpServers: Record<string, { args: string[] }> };
    expect(Object.keys(cfg.mcpServers)).toEqual(["playwright"]);
    expect(cfg.mcpServers.playwright.args).toContain("/p");
  });
});
