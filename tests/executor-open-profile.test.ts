import { describe, it, expect, vi } from "vitest";
import path from "path";
import { openBrowserProfile, chromeCandidates } from "@/executor/open-profile";

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
      platform: "darwin",
      env: {},
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
      platform: "darwin",
      env: {},
    });

    expect(calls[0].bin).toBe("open");
    expect(calls[0].args).toEqual(
      expect.arrayContaining(["-na", "Google Chrome", "--args", "--user-data-dir=/tmp/fake-profile"])
    );
  });

  it("calls unref() so the spawned process doesn't keep the server process alive", () => {
    const child = { pid: 1, unref: vi.fn() };
    const spawnFn = vi.fn(() => child);
    openBrowserProfile({ spawn: spawnFn, existsSync: () => true, profileDir: "/tmp/x", platform: "darwin", env: {} });
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it("defaults the profile dir to data/browser-profile under the current working directory", () => {
    const { spawnFn, calls } = makeFakeSpawn();
    openBrowserProfile({ spawn: spawnFn, existsSync: () => true, platform: "darwin", env: {} });
    const expectedDir = path.join(process.cwd(), "data/browser-profile");
    expect(calls[0].args).toContain(`--user-data-dir=${expectedDir}`);
  });

  it("always passes --no-first-run", () => {
    const { spawnFn, calls } = makeFakeSpawn();
    openBrowserProfile({ spawn: spawnFn, existsSync: () => true, profileDir: "/tmp/x", platform: "darwin", env: {} });
    expect(calls[0].args).toContain("--no-first-run");
  });

  it("CHROME_BIN wins on every platform, even when it is not probed", () => {
    const { spawnFn, calls } = makeFakeSpawn();
    openBrowserProfile({ spawn: spawnFn, existsSync: () => false, profileDir: "/tmp/x", platform: "win32", env: { CHROME_BIN: "D:\\tools\\chrome.exe" } });
    expect(calls[0].bin).toBe("D:\\tools\\chrome.exe");
    expect(calls[0].args).toEqual(["--user-data-dir=/tmp/x", "--no-first-run"]);
  });

  it("probes the stock Windows install locations built from the environment", () => {
    const env = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" };
    const rel = path.join("Google", "Chrome", "Application", "chrome.exe");
    expect(chromeCandidates("win32", env)).toEqual([
      path.join("C:\\Program Files", rel),
      path.join("C:\\Program Files (x86)", rel),
      path.join("C:\\Users\\u\\AppData\\Local", rel),
    ]);
    const { spawnFn, calls } = makeFakeSpawn();
    const hit = path.join("C:\\Users\\u\\AppData\\Local", rel);
    openBrowserProfile({ spawn: spawnFn, existsSync: (p) => p === hit, profileDir: "/tmp/x", platform: "win32", env });
    expect(calls[0].bin).toBe(hit);
  });

  it("falls back to `cmd /c start chrome` on Windows when no install is found", () => {
    const { spawnFn, calls } = makeFakeSpawn();
    openBrowserProfile({ spawn: spawnFn, existsSync: () => false, profileDir: "/tmp/x", platform: "win32", env: {} });
    expect(calls[0].bin).toBe("cmd");
    expect(calls[0].args).toEqual(["/c", "start", "", "chrome", "--user-data-dir=/tmp/x", "--no-first-run"]);
  });

  it("uses google-chrome on Linux", () => {
    const { spawnFn, calls } = makeFakeSpawn();
    openBrowserProfile({ spawn: spawnFn, existsSync: () => false, profileDir: "/tmp/x", platform: "linux", env: {} });
    expect(calls[0].bin).toBe("google-chrome");
  });
});
