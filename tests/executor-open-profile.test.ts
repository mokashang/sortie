import { describe, it, expect, vi } from "vitest";
import path from "path";
import { openBrowserProfile } from "@/executor/open-profile";

// "Login once" affordance: POST /api/executor/open-profile spawns a headed Chrome window on the
// SAME persistent profile dir (data/browser-profile) the headless Playwright MCP executor drives,
// so the user can log into LinkedIn/Workday/etc. once and have that session available to
// unattended runs afterwards. No real Chrome process in tests — spawn and existsSync are both
// injected.

function makeFakeSpawn() {
  const calls: { bin: string; args: string[]; opts: unknown }[] = [];
  const spawnFn = vi.fn((bin: string, args: string[], opts: unknown) => {
    calls.push({ bin, args, opts });
    return { pid: 4242, unref: vi.fn() };
  });
  return { spawnFn, calls };
}

describe("executor/open-profile", () => {
  it("spawns the Chrome.app binary directly with --user-data-dir when it exists at the expected path", () => {
    const { spawnFn, calls } = makeFakeSpawn();
    const result = openBrowserProfile({
      spawn: spawnFn,
      existsSync: () => true,
      profileDir: "/tmp/fake-profile",
    });

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(calls[0].bin).toBe("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(calls[0].args).toContain("--user-data-dir=/tmp/fake-profile");
    expect(calls[0].opts).toMatchObject({ detached: true });
    expect(result.pid).toBe(4242);
  });

  it("falls back to `open -na` with --args when Chrome.app isn't at the expected path", () => {
    const { spawnFn, calls } = makeFakeSpawn();
    openBrowserProfile({
      spawn: spawnFn,
      existsSync: () => false,
      profileDir: "/tmp/fake-profile",
    });

    expect(calls[0].bin).toBe("open");
    expect(calls[0].args).toEqual(
      expect.arrayContaining(["-na", "Google Chrome", "--args", "--user-data-dir=/tmp/fake-profile"])
    );
  });

  it("calls unref() so the spawned process doesn't keep the server process alive", () => {
    const child = { pid: 1, unref: vi.fn() };
    const spawnFn = vi.fn(() => child);
    openBrowserProfile({ spawn: spawnFn, existsSync: () => true, profileDir: "/tmp/x" });
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it("defaults the profile dir to data/browser-profile under the current working directory", () => {
    const { spawnFn, calls } = makeFakeSpawn();
    openBrowserProfile({ spawn: spawnFn, existsSync: () => true });
    const expectedDir = path.join(process.cwd(), "data/browser-profile");
    expect(calls[0].args).toContain(`--user-data-dir=${expectedDir}`);
  });

  it("always passes --no-first-run", () => {
    const { spawnFn, calls } = makeFakeSpawn();
    openBrowserProfile({ spawn: spawnFn, existsSync: () => true, profileDir: "/tmp/x" });
    expect(calls[0].args).toContain("--no-first-run");
  });
});
