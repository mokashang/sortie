import { spawn as nodeSpawn } from "child_process";
import fs from "fs";
import path from "path";

// Windows launchers for the attended `claude --chrome` session (spec: docs/superpowers/specs/
// 2026-09-06-windows-server-migration-design.md §3). macOS keeps the expect path in attended.ts;
// Windows has no expect, so:
//   pty mode (default): node-pty gives claude a real ConPTY pseudo-console (the interactive TUI
//     needs one), we tee its output into the run's transcript log and answer the same first-run
//     prompts expect used to ("Enter to confirm").
//   console mode (ATTENDED_SPAWN_MODE=console): plain detached spawn with its own console window.
//     No transcript, no auto-Enter — only for boxes where node-pty failed to install.

// CSI sequences (colours, cursor moves) and OSC sequences (window title) — stripped before
// matching so a prompt split by a colour change is still recognised.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*\x07/g;

// Decides when to press Enter for the child from its raw terminal output. Pure so it is
// unit-testable: feed() returns true when a known prompt is visible and we have not answered one
// within `cooldownMs` (the TUI redraws the same dialog many times per second).
export class PromptAnswerer {
  private tail = "";
  private lastAnswerAt = -Infinity;
  constructor(
    private readonly patterns: RegExp[] = [/Enter to confirm/i, /Press Enter to continue/i],
    private readonly cooldownMs = 2000,
    private readonly keep = 4096
  ) {}

  feed(chunk: string, now: number = Date.now()): boolean {
    this.tail = (this.tail + chunk.replace(ANSI, "")).slice(-this.keep);
    if (now - this.lastAnswerAt < this.cooldownMs) return false;
    if (!this.patterns.some((p) => p.test(this.tail))) return false;
    this.lastAnswerAt = now;
    this.tail = "";
    return true;
  }
}

// The slice of node-pty we use, so tests can hand in a fake and macOS never loads the native module.
export interface PtyProcess {
  pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  write(data: string): void;
}
export interface PtyModule {
  spawn(
    file: string,
    args: string[],
    opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }
  ): PtyProcess;
}

// Lazy CJS require: node-pty is an optionalDependency and a native module. Resolving it at import
// time would load it on macOS too and break `next build` wherever it is not installed. It is also
// listed in next.config.ts serverExternalPackages so the bundler leaves the require alone.
//
// The require is anchored at <cwd>/package.json, NOT at import.meta.url: inside the production
// server bundle `import.meta.url` is compiled away, so `createRequire(import.meta.url)` produced
// `undefined` and every dispatcher tick on the Windows box failed with "(void 0) is not a
// function" — silently, because the route only returned the error as JSON (2026-09-11). The server
// always runs with cwd = repo root (pm2 ecosystem / launchd), which is where node_modules lives.
//
// And the `module` builtin is fetched through process.getBuiltinModule (Node >= 22.3) — a plain
// `import { createRequire } from "module"` came out of the bundle as `undefined` as well ("a is not
// a function" after the first attempt). `eval("require")` is the fallback for older Node 22.x: it
// reaches the real Node require that webpack's module wrapper closes over.
type ModuleBuiltin = { createRequire: (filename: string) => (id: string) => unknown };
export function defaultPtyRequire(cwd = process.cwd()): (id: string) => unknown {
  const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const mod = (getBuiltin ? getBuiltin("module") : eval("require")("module")) as ModuleBuiltin;
  return mod.createRequire(path.join(cwd, "package.json"));
}

export function loadNodePty(requireFn: (id: string) => unknown = defaultPtyRequire()): PtyModule {
  try {
    return requireFn("node-pty") as PtyModule;
  } catch (e) {
    throw new Error(
      `node-pty is not installed (${(e as Error).message}). Re-run \`npm ci\` (it needs a prebuilt binary or build tools for this Node version), or set ATTENDED_SPAWN_MODE=console in .env to launch the attended session in a plain console window instead.`
    );
  }
}

export interface WindowsSpawnOptions {
  claudeBin: string;
  args: string[];
  cwd: string;
  logPath: string;
  env?: Record<string, string | undefined>;
}

export function spawnAttendedPty(
  opts: WindowsSpawnOptions,
  deps: { pty?: PtyModule; env?: Record<string, string | undefined>; now?: () => number } = {}
): { pid: number } {
  const pty = deps.pty ?? loadNodePty();
  // node-pty wants a string→string map; drop undefined entries from process.env.
  const env = Object.fromEntries(
    Object.entries(deps.env ?? opts.env ?? process.env).filter((kv): kv is [string, string] => typeof kv[1] === "string")
  );
  const proc = pty.spawn(opts.claudeBin, opts.args, { name: "xterm-256color", cols: 200, rows: 50, cwd: opts.cwd, env });
  const fd = fs.openSync(opts.logPath, "a");
  const answerer = new PromptAnswerer();
  const now = deps.now ?? Date.now;
  proc.onData((data) => {
    try {
      fs.writeSync(fd, data);
    } catch {
      // transcript is best-effort; the run log in the App is the source of truth
    }
    if (answerer.feed(data, now())) proc.write("\r");
  });
  proc.onExit(({ exitCode }) => {
    try {
      fs.writeSync(fd, `\n[attended] claude exited with code ${exitCode}\n`);
      fs.closeSync(fd);
    } catch {
      // already closed
    }
  });
  return { pid: proc.pid };
}

export type ConsoleSpawnFn = (
  bin: string,
  args: string[],
  opts: { cwd: string; detached: true; stdio: "ignore"; windowsHide: false; env?: Record<string, string | undefined> }
) => { pid?: number; unref(): void };

export function spawnAttendedConsole(opts: WindowsSpawnOptions, deps: { spawn?: ConsoleSpawnFn } = {}): { pid: number } {
  const spawnFn = deps.spawn ?? (nodeSpawn as unknown as ConsoleSpawnFn);
  // detached on Windows = the child gets its own console window, which is the TTY the TUI needs.
  const child = spawnFn(opts.claudeBin, opts.args, { cwd: opts.cwd, detached: true, stdio: "ignore", windowsHide: false, env: opts.env });
  child.unref();
  fs.writeFileSync(opts.logPath, "[attended] console mode: no transcript is captured; follow the run log in the App.\n");
  return { pid: child.pid ?? -1 };
}
