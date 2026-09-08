import { describe, it, expect } from "vitest";
import path from "path";
import { resolveClaudeBin } from "@/lib/claude-bin";

const home = "/home/u";

describe("resolveClaudeBin", () => {
  it("prefers CLAUDE_BIN when it exists", () => {
    expect(
      resolveClaudeBin({ env: { CLAUDE_BIN: "/x/claude" }, homedir: home, platform: "darwin", existsSync: (p) => p === "/x/claude" })
    ).toBe("/x/claude");
  });

  it("falls back to ~/.local/bin/claude, then to bare `claude` on PATH", () => {
    const local = path.join(home, ".local", "bin", "claude");
    expect(resolveClaudeBin({ env: {}, homedir: home, platform: "darwin", existsSync: (p) => p === local })).toBe(local);
    expect(resolveClaudeBin({ env: {}, homedir: home, platform: "darwin", existsSync: () => false })).toBe("claude");
  });

  it("also tries ~/.local/bin/claude.exe on Windows (native installer location), and only there", () => {
    const exe = path.join(home, ".local", "bin", "claude.exe");
    expect(resolveClaudeBin({ env: {}, homedir: home, platform: "win32", existsSync: (p) => p === exe })).toBe(exe);
    expect(resolveClaudeBin({ env: {}, homedir: home, platform: "darwin", existsSync: (p) => p === exe })).toBe("claude");
  });
});
