import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  PromptAnswerer,
  loadNodePty,
  defaultPtyRequire,
  spawnAttendedPty,
  spawnAttendedConsole,
  type PtyModule,
  type PtyProcess,
} from "@/executor/attended-win";

const tmpLog = (name: string) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "attended-win-")), name);

describe("PromptAnswerer", () => {
  it("answers once when the prompt text arrives across chunks, ignoring ANSI escapes", () => {
    const a = new PromptAnswerer();
    expect(a.feed("\x1b[1mEnter to ", 1000)).toBe(false);
    expect(a.feed("confirm\x1b[0m · Esc to exit", 1001)).toBe(true);
  });

  it("does not answer again within the cooldown, but does after it", () => {
    const a = new PromptAnswerer([/Enter to confirm/], 2000);
    expect(a.feed("Enter to confirm", 0)).toBe(true);
    expect(a.feed("Enter to confirm", 500)).toBe(false);
    expect(a.feed("Enter to confirm", 2500)).toBe(true);
  });

  it("ignores unrelated output and recognises the Chrome intro prompt", () => {
    expect(new PromptAnswerer().feed("hello world", 0)).toBe(false);
    expect(new PromptAnswerer().feed("Press Enter to continue", 0)).toBe(true);
  });
});

describe("spawnAttendedPty", () => {
  it("spawns claude on a pseudo-console, tees output to the log and presses Enter on the confirm prompt", () => {
    const logPath = tmpLog("attended-1.log");
    const written: string[] = [];
    let onData: (d: string) => void = () => {};
    let onExit: (e: { exitCode: number }) => void = () => {};
    const spawned: { file: string; args: string[]; opts: unknown }[] = [];
    const pty: PtyModule = {
      spawn: (file, args, opts) => {
        spawned.push({ file, args, opts });
        const proc: PtyProcess = {
          pid: 555,
          onData: (cb) => { onData = cb; },
          onExit: (cb) => { onExit = cb; },
          write: (d) => { written.push(d); },
        };
        return proc;
      },
    };
    const r = spawnAttendedPty(
      { claudeBin: "C:\\claude.exe", args: ["--chrome", "hi"], cwd: "C:\\sortie", logPath },
      { pty, env: { PATH: "x", EMPTY: undefined }, now: () => 0 }
    );
    expect(r.pid).toBe(555);
    expect(spawned[0]).toMatchObject({ file: "C:\\claude.exe", args: ["--chrome", "hi"] });
    expect(spawned[0].opts).toMatchObject({ cwd: "C:\\sortie", cols: 200, rows: 50, env: { PATH: "x" } });
    expect((spawned[0].opts as { env: Record<string, string> }).env).not.toHaveProperty("EMPTY");
    onData("Do you trust the files in this folder? Enter to confirm");
    expect(written).toEqual(["\r"]);
    onExit({ exitCode: 0 });
    const log = fs.readFileSync(logPath, "utf8");
    expect(log).toContain("Enter to confirm");
    expect(log).toContain("exited with code 0");
  });
});

describe("spawnAttendedConsole", () => {
  it("spawns detached with its own console window and leaves a note in the log", () => {
    const logPath = tmpLog("attended-2.log");
    const child = { pid: 777, unref: vi.fn() };
    const calls: { bin: string; args: string[]; opts: unknown }[] = [];
    const r = spawnAttendedConsole(
      { claudeBin: "C:\\claude.exe", args: ["--chrome"], cwd: "C:\\sortie", logPath },
      { spawn: (bin, args, opts) => { calls.push({ bin, args, opts }); return child; } }
    );
    expect(r.pid).toBe(777);
    expect(calls[0]).toMatchObject({ bin: "C:\\claude.exe", args: ["--chrome"] });
    expect(calls[0].opts).toEqual({ cwd: "C:\\sortie", detached: true, stdio: "ignore", windowsHide: false });
    expect(child.unref).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(logPath, "utf8")).toContain("console mode");
  });
});

describe("defaultPtyRequire", () => {
  it("returns a real require anchored at <cwd>/package.json (no import.meta, no static module import)", () => {
    const req = defaultPtyRequire(process.cwd());
    expect(typeof req).toBe("function");
    // resolves packages the same way the server does at runtime
    expect(typeof (req("better-sqlite3") as unknown)).toBe("function");
  });
});

describe("loadNodePty", () => {
  it("returns the module when it resolves", () => {
    const fake = { spawn: vi.fn() };
    expect(loadNodePty(() => fake)).toBe(fake);
  });
  it("explains the console fallback when node-pty is missing", () => {
    expect(() => loadNodePty(() => { throw new Error("Cannot find module 'node-pty'"); })).toThrow(/ATTENDED_SPAWN_MODE=console/);
  });
});
