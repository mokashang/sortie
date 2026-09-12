import { describe, it, expect } from "vitest";
import path from "path";
import { browserProfileDir, executorBrowserHeaded, playwrightMcpConfig, playwrightMcpServer } from "@/executor/mcp-config";

describe("executor mcp-config", () => {
  it("puts the dedicated Chrome profile at <cwd>/data/browser-profile", () => {
    expect(browserProfileDir("/srv/app")).toBe(path.join("/srv/app", "data", "browser-profile"));
    expect(browserProfileDir()).toBe(path.join(process.cwd(), "data", "browser-profile"));
  });

  it("spawns npx directly on POSIX and through cmd /c on native Windows", () => {
    expect(playwrightMcpServer("/p", "darwin", true)).toEqual({
      command: "npx",
      args: ["-y", "@playwright/mcp@latest", "--browser", "chrome", "--user-data-dir", "/p"],
    });
    expect(playwrightMcpServer("C:\\sortie\\data\\browser-profile", "win32", true)).toEqual({
      command: "cmd",
      args: ["/c", "npx", "-y", "@playwright/mcp@latest", "--browser", "chrome", "--user-data-dir", "C:\\sortie\\data\\browser-profile"],
    });
  });

  it("runs the executor's Chrome headless unless EXECUTOR_BROWSER_HEADED is set (no window popping up)", () => {
    expect(playwrightMcpServer("/p", "darwin", false).args).toEqual([
      "-y", "@playwright/mcp@latest", "--browser", "chrome", "--user-data-dir", "/p", "--headless",
    ]);
    expect(playwrightMcpServer("/p", "win32", false).args.at(-1)).toBe("--headless");
    expect(playwrightMcpServer("/p", "win32", true).args).not.toContain("--headless");
    // default = headless (the env var is unset in the test process)
    expect(playwrightMcpServer("/p", "linux").args).toContain("--headless");
    const cfg = JSON.parse(playwrightMcpConfig("/p", "linux", false)) as { mcpServers: Record<string, { args: string[] }> };
    expect(cfg.mcpServers.playwright.args).toContain("--headless");
    const headed = JSON.parse(playwrightMcpConfig("/p", "linux", true)) as { mcpServers: Record<string, { args: string[] }> };
    expect(headed.mcpServers.playwright.args).not.toContain("--headless");
  });

  it("executorBrowserHeaded reads the EXECUTOR_BROWSER_HEADED switch (empty/missing = headless)", () => {
    expect(executorBrowserHeaded({})).toBe(false);
    expect(executorBrowserHeaded({ EXECUTOR_BROWSER_HEADED: "" })).toBe(false);
    expect(executorBrowserHeaded({ EXECUTOR_BROWSER_HEADED: "1" })).toBe(true);
  });

  it("serialises a --mcp-config string with playwright as the only server", () => {
    const cfg = JSON.parse(playwrightMcpConfig("/p", "linux")) as { mcpServers: Record<string, { args: string[] }> };
    expect(Object.keys(cfg.mcpServers)).toEqual(["playwright"]);
    expect(cfg.mcpServers.playwright.args).toContain("/p");
  });
});
