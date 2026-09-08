# Windows 常开机迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让同一份 Sortie 代码在 Windows 11 上作为常开服务器运行(值守会话、通知、进程管理、Chrome 路径全部按平台分支),并交付 Windows 侧的部署脚本与切换 runbook;Mac 路径与行为保持不变。

**Architecture:** 运行时按 `process.platform` 分支,不做第二个版本:macOS 继续用 expect / osascript / 进程组 SIGTERM;Windows 用 node-pty(ConPTY)拉起 `claude.exe --chrome`、taskkill 树杀、ntfy 通知。所有平台相关调用都经依赖注入(`platform`、`spawn*`、`exec`、`env`),单测在 Mac 上覆盖两条路径。Windows 侧的常驻由 pm2 + 任务计划「登录时」承担(不是 Windows 服务),脚本放 `ops/windows/`。

**Tech Stack:** Next.js 15、better-sqlite3(含 `db.backup()` API)、node-pty(optionalDependency)、vitest、pm2、Windows Task Scheduler(PowerShell `ScheduledTasks` 模块)、Tailscale Serve、Caddy(阶段 2)。

**Spec:** `docs/superpowers/specs/2026-09-06-windows-server-migration-design.md`

## Global Constraints

- 同一份代码、同一个 build;平台差异只在运行时分支(`process.platform`),不引入第二套代码或构建配置。
- 服务器继续只绑 `127.0.0.1:3000`;App 不加任何鉴权;`instrumentation.ts`、skills 里的 `http://127.0.0.1:3000`、扫描/匹配/去重/UI 一律不改。
- macOS 现有行为逐字保留:expect 脚本、osascript 通知、`/Applications/Google Chrome.app` 路径、进程组 SIGTERM;现有测试只允许追加 `platform: "darwin"` 之类的显式注入,不改断言语义。
- 任何脚本都不请求、不存储、不打印密码或 token(自动登录由用户手工用 Sysinternals Autologon 设置;`CF_API_TOKEN` 由用户写进 `.env`)。
- SQLite 单写者:runbook 里任何步骤都不能让 Mac 和 Windows 同时对同一份数据写。
- Node `>=22`;`node-pty` 只能是 `optionalDependencies`,缺失时 win32 路径抛出指向 `ATTENDED_SPAWN_MODE=console` 的明确错误,`npm ci` 不得因此失败。
- pm2 环境钉死 `TZ=America/Los_Angeles`;任务计划全部「仅当用户登录时运行」`LogonType Interactive`,执行时限为 0(不限)。
- Windows 仓库根目录 `C:\sortie`;数据在 `C:\sortie\data`(不在 OneDrive 同步目录)。
- 提交信息格式沿用仓库习惯(`feat(executor): …` / `docs: …`),每个 task 一次提交。

**Scope note:** 本计划只覆盖仓库内可在 Mac 上测试的改动(代码 + ops 脚本 + 文档/runbook)。Windows 机器上的安装、切换、真机验收按 Task 11 产出的 `ops/windows/README.md` 执行,不在本计划的任务里(那是运维操作,不是软件)。

---

## File Structure

新建:
- `src/lib/proc-kill.ts` — `killTree(pid, deps?)`:POSIX 进程组 SIGTERM / Windows `taskkill /T /F`,被 `runner.ts` 与 `attended.ts` 共用。
- `src/executor/attended-win.ts` — Windows 拉起器:`PromptAnswerer`(纯逻辑:去 ANSI、匹配首次提示、冷却)、`spawnAttendedPty`(node-pty)、`spawnAttendedConsole`(独立控制台兜底)、`loadNodePty`(惰性加载 + 明确报错)。
- `src/lib/backup.ts` — `backupFileName` / `selectBackupsToPrune` / `backupDatabase`(在线备份 + 保留策略)。
- `scripts/backup-db.ts` — `npm run backup` 薄壳。
- `ops/windows/ecosystem.config.cjs`、`deploy.ps1`、`setup.ps1`、`start-chrome.cmd`、`Caddyfile`、`README.md`(runbook)。
- `tests/proc-kill.test.ts`、`tests/claude-bin.test.ts`、`tests/attended-win.test.ts`、`tests/backup.test.ts`。
- `.gitattributes`。

修改:
- `src/lib/notify.ts`(+ `tests/notify.test.ts`)— darwin 才调 osascript;非 darwin 无 topic 时警告一次。
- `src/lib/claude-bin.ts` — 依赖注入 + `claude.exe` 候选。
- `src/executor/open-profile.ts`(+ 测试)— `CHROME_BIN` + 各平台候选路径。
- `src/executor/attended.ts`(+ 测试)— `buildAttendedArgs` 抽取;win32 分支选择拉起器;`killTree`。
- `src/executor/runner.ts` — `stopExecutor` 用 `killTree`。
- `src/resume/pdf-text.ts` — `PDFTOTEXT_BIN`。
- `next.config.ts` — `serverExternalPackages` 加 `node-pty`。
- `package.json` / `package-lock.json` — `engines`、`optionalDependencies.node-pty`、`scripts.backup`。
- `.env.example`、`README.md`、`CLAUDE.md`、spec(一处端点名修正)。

---

### Task 1: 仓库可移植性基线(.gitattributes + engines + PDFTOTEXT_BIN)

**Files:**
- Create: `.gitattributes`
- Modify: `package.json`(`engines`)
- Modify: `src/resume/pdf-text.ts:1-16`
- Test: `tests/resume-pdf-text.test.ts`(只运行,不改)

**Interfaces:**
- Produces: 环境变量 `PDFTOTEXT_BIN`(可选,默认 `"pdftotext"`);仓库内所有文本文件以 LF 入库。

- [ ] **Step 1: 写 `.gitattributes`**

```gitattributes
# Windows 上开发也按 LF 入库,避免 CRLF 污染 diff;二进制按扩展名标记。
* text=auto eol=lf
*.png binary
*.jpg binary
*.pdf binary
*.db binary
*.cmd text eol=crlf
*.ps1 text eol=crlf
```

- [ ] **Step 2: 确认规范化不会改动现有文件**

Run: `git add --renormalize . && git status --short`
Expected: 只有 `A  .gitattributes` 一行(仓库一直在 Mac 上开发,已全是 LF)。若出现其他文件,说明它们本来就是 CRLF,把它们一并纳入本次提交即可。

- [ ] **Step 3: `package.json` 加 engines**

在 `"private": true,` 之后插入:

```json
  "engines": {
    "node": ">=22"
  },
```

- [ ] **Step 4: `pdf-text.ts` 支持 `PDFTOTEXT_BIN`**

把 `src/resume/pdf-text.ts` 开头的 `defaultExec` 改成:

```ts
import { execFile } from "child_process";

export type PdftotextExec = (pdfPath: string) => Promise<string>;

// `pdftotext` (poppler) is resolved from PATH by default; PDFTOTEXT_BIN pins an absolute path
// (Windows installs of poppler are rarely on PATH). Symmetric with TECTONIC_BIN in compile.ts.
const defaultExec: PdftotextExec = (pdfPath) =>
  new Promise((resolve, reject) => {
    execFile(
      process.env.PDFTOTEXT_BIN || "pdftotext",
      ["-layout", pdfPath, "-"],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      }
    );
  });
```

其余保持不变。

- [ ] **Step 5: 跑相关测试**

Run: `npx vitest run tests/resume-pdf-text.test.ts`
Expected: PASS(该文件的测试都注入 `exec`,不碰真二进制)。

- [ ] **Step 6: Commit**

```bash
git add .gitattributes package.json src/resume/pdf-text.ts
git commit -m "chore: LF gitattributes, node>=22 engines, PDFTOTEXT_BIN override (Windows migration baseline)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: notify 只在 macOS 弹 osascript,非 macOS 无 topic 时警告一次

**Files:**
- Modify: `src/lib/notify.ts`
- Test: `tests/notify.test.ts`

**Interfaces:**
- Produces: `notify(title, body, opts)` 新增 `opts.platform?: NodeJS.Platform`(默认 `process.platform`);新增 `resetNotifyWarningForTests(): void`。

- [ ] **Step 1: 先改测试(失败态)**

在 `tests/notify.test.ts` 里:
1. 第一个用例 `"posts to ntfy when topic configured and calls macos notifier"` 的 `notify(...)` 调用参数里加 `platform: "darwin",`(在 `execMacNotifier: fakeExec,` 之后)。
2. 顶部 import 改成 `import { notify, escapeAppleScript, encodeNtfyTitle, resetNotifyWarningForTests } from "@/lib/notify";`
3. 在 `describe("notify", …)` 里追加两个用例:

```ts
  it("does not call the macOS notifier off macOS", async () => {
    const fakeExec = vi.fn();
    const fakeFetch = async () => new Response("ok");
    await notify("t", "b", { ntfyTopic: "topic", fetcher: fakeFetch as typeof fetch, execMacNotifier: fakeExec, platform: "win32" });
    expect(fakeExec).not.toHaveBeenCalled();
  });

  it("warns once per process when off macOS and no ntfy topic is configured", async () => {
    vi.stubEnv("NTFY_TOPIC", "");
    resetNotifyWarningForTests();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const opts = { ntfyTopic: undefined, fetcher: vi.fn() as unknown as typeof fetch, execMacNotifier: vi.fn(), platform: "win32" as const };
    await notify("t", "b", opts);
    await notify("t", "b", opts);
    const topicWarnings = warnSpy.mock.calls.filter((c) => String(c[0]).includes("NTFY_TOPIC"));
    expect(topicWarnings).toHaveLength(1);
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/notify.test.ts`
Expected: FAIL — `resetNotifyWarningForTests` 不存在(导入为 undefined 调用报错),且 win32 用例里 `fakeExec` 被调用。

- [ ] **Step 3: 实现**

`src/lib/notify.ts` 中 `notify` 函数及其上方改为:

```ts
// Off macOS there is no desktop notifier, so ntfy is the only channel. Warn once per process
// when it is not configured: a Windows deploy without NTFY_TOPIC must show up in the server log
// instead of silently dropping every notification.
let warnedNoTopic = false;
export function resetNotifyWarningForTests(): void {
  warnedNoTopic = false;
}

export async function notify(
  title: string,
  body: string,
  opts: {
    ntfyTopic?: string;
    priority?: "default" | "high";
    fetcher?: typeof fetch;
    execMacNotifier?: MacNotifier;
    platform?: NodeJS.Platform;
  } = {}
): Promise<void> {
  const topic = opts.ntfyTopic ?? process.env.NTFY_TOPIC;
  const fetcher = opts.fetcher ?? fetch;
  const platform = opts.platform ?? process.platform;

  if (platform === "darwin") {
    (opts.execMacNotifier ?? defaultMacNotifier)(title, body);
  } else if (!topic && !warnedNoTopic) {
    warnedNoTopic = true;
    console.warn("[notify] NTFY_TOPIC is not set and this is not macOS: notifications are being dropped. Set NTFY_TOPIC in .env.");
  }
  if (topic) {
    try {
      await fetcher(`https://ntfy.sh/${topic}`, {
        method: "POST",
        body,
        headers: { Title: encodeNtfyTitle(title), Priority: opts.priority === "high" ? "high" : "default" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      // 通知失败绝不阻塞流水线(spec §11.1),但至少留个痕迹方便排查
      console.warn("[notify] ntfy push failed:", e);
    }
  }
}
```

删除原来的 `const mac = opts.execMacNotifier ?? defaultMacNotifier;` 与 `mac(title, body);` 两行(已并入上面的分支)。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/notify.test.ts`
Expected: PASS(全部用例)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/notify.ts tests/notify.test.ts
git commit -m "feat(notify): osascript only on macOS; warn once when ntfy is unconfigured elsewhere

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 跨平台树杀 `killTree`,接入 runner 与 attended

**Files:**
- Create: `src/lib/proc-kill.ts`
- Create: `tests/proc-kill.test.ts`
- Modify: `src/executor/runner.ts:344-353`(`stopExecutor` 内的 kill 块)
- Modify: `src/executor/attended.ts`(`defaultKill` 与 `dispatchAttended` 的 reap 分支)

**Interfaces:**
- Produces: `killTree(pid: number, deps?: { platform?: NodeJS.Platform; kill?: (pid: number, signal: NodeJS.Signals) => void; exec?: (file: string, args: string[]) => void }): void`。永不抛错。

- [ ] **Step 1: 写失败测试 `tests/proc-kill.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { killTree } from "@/lib/proc-kill";

describe("killTree", () => {
  it("SIGTERMs the process group on POSIX", () => {
    const calls: [number, string][] = [];
    killTree(4242, { platform: "darwin", kill: (p, s) => { calls.push([p, s]); } });
    expect(calls).toEqual([[-4242, "SIGTERM"]]);
  });

  it("falls back to the bare pid when the group kill throws, and swallows a second failure", () => {
    const calls: number[] = [];
    killTree(7, {
      platform: "linux",
      kill: (p) => {
        calls.push(p);
        if (p < 0) throw new Error("ESRCH");
      },
    });
    expect(calls).toEqual([-7, 7]);
    expect(() => killTree(8, { platform: "linux", kill: () => { throw new Error("ESRCH"); } })).not.toThrow();
  });

  it("uses taskkill /T /F on Windows and never signals", () => {
    const execs: [string, string[]][] = [];
    const kill = vi.fn();
    killTree(123, { platform: "win32", exec: (f, a) => { execs.push([f, a]); }, kill });
    expect(execs).toEqual([["taskkill", ["/pid", "123", "/t", "/f"]]]);
    expect(kill).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/proc-kill.test.ts`
Expected: FAIL — 找不到模块 `@/lib/proc-kill`。

- [ ] **Step 3: 实现 `src/lib/proc-kill.ts`**

```ts
import { execFile } from "child_process";

export interface KillTreeDeps {
  platform?: NodeJS.Platform;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  exec?: (file: string, args: string[]) => void;
}

// Terminates a detached child and everything it spawned. POSIX: SIGTERM the process group
// (negative pid — our detached children are group leaders), falling back to the bare pid when
// the group signal errors (already gone, or a fake pid in tests). Windows has no process group
// we can signal: `taskkill /T /F` kills the tree by pid instead. Never throws — callers record the
// user's intent to stop regardless of whether the OS-level kill landed.
export function killTree(pid: number, deps: KillTreeDeps = {}): void {
  const platform = deps.platform ?? process.platform;
  if (platform === "win32") {
    const exec = deps.exec ?? ((file, args) => { execFile(file, args, () => {}); });
    exec("taskkill", ["/pid", String(pid), "/t", "/f"]);
    return;
  }
  const kill = deps.kill ?? ((p, s) => { process.kill(p, s); });
  try {
    kill(-pid, "SIGTERM");
  } catch {
    try {
      kill(pid, "SIGTERM");
    } catch {
      // process already gone — nothing left to signal
    }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/proc-kill.test.ts`
Expected: PASS。

- [ ] **Step 5: 接入 `runner.ts`**

在 `src/executor/runner.ts` 顶部 import 区加 `import { killTree } from "@/lib/proc-kill";`。把 `stopExecutor` 里这一段:

```ts
  if (row.channel !== "user_chrome" && row.pid != null && row.pid > 0) {
    try {
      process.kill(-row.pid, "SIGTERM");
    } catch {
      try {
        process.kill(row.pid, "SIGTERM");
      } catch {
        // process already gone — nothing left to signal, still record the stop below
      }
    }
  }
```

替换为:

```ts
  if (row.channel !== "user_chrome" && row.pid != null && row.pid > 0) {
    killTree(row.pid);
  }
```

并把该函数上方注释里 "Sends SIGTERM to the run's process group (negative pid) … isn't really a process group leader)." 改为 "Kills the run's whole process tree via killTree() (process-group SIGTERM on POSIX, taskkill on Windows)."。

- [ ] **Step 6: 接入 `attended.ts`**

顶部加 `import { killTree } from "@/lib/proc-kill";`。删除整个 `function defaultKill(pid: number): void { … }`,并把 `dispatchAttended` 里 `(deps.kill ?? defaultKill)(decision.pid);` 改为 `(deps.kill ?? killTree)(decision.pid);`。

- [ ] **Step 7: 跑执行器相关测试**

Run: `npx vitest run tests/executor-runner.test.ts tests/executor-attended.test.ts tests/proc-kill.test.ts`
Expected: PASS(`stopExecutor` 用例 spy 的是 `process.kill`,`killTree` 默认 kill 仍然动态调用它)。

- [ ] **Step 8: Commit**

```bash
git add src/lib/proc-kill.ts tests/proc-kill.test.ts src/executor/runner.ts src/executor/attended.ts
git commit -m "feat(executor): killTree — process-group SIGTERM on POSIX, taskkill /T on Windows; used by stopExecutor and the attended reaper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `resolveClaudeBin` 可注入 + Windows `claude.exe` 候选

**Files:**
- Modify: `src/lib/claude-bin.ts`
- Create: `tests/claude-bin.test.ts`

**Interfaces:**
- Produces: `resolveClaudeBin(deps?: { env?: NodeJS.ProcessEnv; homedir?: string; platform?: NodeJS.Platform; existsSync?: (p: string) => boolean }): string`。无参调用行为不变(现有调用点 `runner.ts` / `attended.ts` / `subscription.ts` 不用改)。

- [ ] **Step 1: 写失败测试 `tests/claude-bin.test.ts`**

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/claude-bin.test.ts`
Expected: FAIL — 现有实现忽略参数(第一个用例返回 `"claude"` 而不是 `/x/claude`)。

- [ ] **Step 3: 实现**

`src/lib/claude-bin.ts` 整个文件改为:

```ts
import fs from "fs";
import os from "os";
import path from "path";

export interface ResolveClaudeBinDeps {
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  platform?: NodeJS.Platform;
  existsSync?: (p: string) => boolean;
}

// Shared claude CLI binary resolution: CLAUDE_BIN env → ~/.local/bin/claude (the native
// installer's location; `claude.exe` on Windows) → bare "claude" on PATH. Needed because a
// supervisor-launched server (launchd on macOS, the pm2 logon task on Windows) can have a PATH
// that does not include ~/.local/bin.
export function resolveClaudeBin(deps: ResolveClaudeBinDeps = {}): string {
  const env = deps.env ?? process.env;
  const home = deps.homedir ?? os.homedir();
  const platform = deps.platform ?? process.platform;
  const existsSync = deps.existsSync ?? fs.existsSync;
  const candidates = [
    env.CLAUDE_BIN,
    path.join(home, ".local", "bin", "claude"),
    ...(platform === "win32" ? [path.join(home, ".local", "bin", "claude.exe")] : []),
  ].filter((c): c is string => !!c);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "claude";
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/claude-bin.test.ts tests/executor-runner.test.ts tests/subscription-backend.test.ts`
Expected: PASS(后两个文件是现有的调用方回归:无参调用行为不变)。

- [ ] **Step 5: Commit**

```bash
git add src/lib/claude-bin.ts tests/claude-bin.test.ts
git commit -m "feat(claude-bin): injectable resolution; try ~/.local/bin/claude.exe on Windows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `open-profile` 支持 `CHROME_BIN` 与各平台 Chrome 路径

**Files:**
- Modify: `src/executor/open-profile.ts`
- Modify: `tests/executor-open-profile.test.ts`

**Interfaces:**
- Produces: `chromeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[]`;`openBrowserProfile(deps)` 新增 `deps.platform?`、`deps.env?`;返回值 `{ bin, args, pid }` 不变。

- [ ] **Step 1: 先改测试(失败态)**

`tests/executor-open-profile.test.ts`:
1. import 改为 `import { openBrowserProfile, chromeCandidates } from "@/executor/open-profile";`
2. 现有五个用例的每次 `openBrowserProfile({ … })` 调用都加上 `platform: "darwin", env: {},`(保证在 Windows 上跑测试时仍走 macOS 断言)。
3. 追加:

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/executor-open-profile.test.ts`
Expected: FAIL — `chromeCandidates` 未导出;win32 用例走了 macOS 逻辑。

- [ ] **Step 3: 实现**

`src/executor/open-profile.ts` 从 `const CHROME_APP_BIN` 到文件末尾替换为:

```ts
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Where a stock Chrome install lives per platform, most specific first. Windows paths are built
// from the environment so tests can pin them; on a real box ProgramFiles / LOCALAPPDATA always exist.
export function chromeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "darwin") return [MAC_CHROME];
  if (platform === "win32") {
    const rel = path.join("Google", "Chrome", "Application", "chrome.exe");
    return [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA]
      .filter((d): d is string => !!d)
      .map((d) => path.join(d, rel));
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
}

// A structural subset of child_process.ChildProcess — mirrors the pattern in executor/runner.ts
// so tests can inject a fake without touching the real filesystem/process table.
export interface SpawnedChild {
  pid?: number;
  unref(): void;
}

export type SpawnFn = (
  bin: string,
  args: string[],
  opts: { detached: boolean; stdio: "ignore" }
) => SpawnedChild;

export interface OpenProfileDeps {
  spawn?: SpawnFn;
  existsSync?: (p: string) => boolean;
  profileDir?: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}

export interface OpenProfileResult {
  bin: string;
  args: string[];
  pid: number | undefined;
}

export function openBrowserProfile(deps: OpenProfileDeps = {}): OpenProfileResult {
  const spawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const existsSync = deps.existsSync ?? fs.existsSync;
  const profileDir = deps.profileDir ?? path.join(process.cwd(), "data/browser-profile");
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const userDataDir = `--user-data-dir=${profileDir}`;

  // CHROME_BIN is an explicit override and is trusted as-is (a wrong path surfaces as ENOENT).
  const found = env.CHROME_BIN || chromeCandidates(platform, env).find((c) => existsSync(c));

  let bin: string;
  let args: string[];
  if (found) {
    bin = found;
    args = [userDataDir, "--no-first-run"];
  } else if (platform === "darwin") {
    // Launch Services app-name resolution when Chrome.app isn't at the usual path.
    bin = "open";
    args = ["-na", "Google Chrome", "--args", userDataDir, "--no-first-run"];
  } else if (platform === "win32") {
    // `start` resolves `chrome` through the App Paths registry key.
    bin = "cmd";
    args = ["/c", "start", "", "chrome", userDataDir, "--no-first-run"];
  } else {
    bin = "google-chrome";
    args = [userDataDir, "--no-first-run"];
  }

  const child = spawnFn(bin, args, { detached: true, stdio: "ignore" });
  child.unref();

  return { bin, args, pid: child.pid };
}
```

文件头部注释里 "falling back to `open -na "Google Chrome" --args ...` … if the .app isn't at the usual path." 后追加一句 "Windows probes Program Files / LocalAppData (or CHROME_BIN), falling back to `cmd /c start chrome`."。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/executor-open-profile.test.ts`
Expected: PASS(9 个用例)。

- [ ] **Step 5: Commit**

```bash
git add src/executor/open-profile.ts tests/executor-open-profile.test.ts
git commit -m "feat(executor): open-profile honours CHROME_BIN and probes Windows/Linux Chrome locations

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 抽取 `buildAttendedArgs`,expect 脚本改为消费它

**Files:**
- Modify: `src/executor/attended.ts:119-133`(`buildExpectScript`)
- Modify: `tests/executor-attended.test.ts`

**Interfaces:**
- Produces: `buildAttendedArgs(opts: { runId: number; prompt: string; sessionName?: string }): string[]` — 返回 `["--chrome", "--permission-mode", "dontAsk", "--allowedTools", ...ATTENDED_ALLOWED_TOOLS, "-n", <sessionName|sortie-run-N>, prompt]`。Task 8 的 Windows 拉起器直接把它交给 `claude.exe`。
- `buildExpectScript` 签名不变。

- [ ] **Step 1: 写失败测试**

在 `tests/executor-attended.test.ts` 的 import 列表加 `buildAttendedArgs, ATTENDED_ALLOWED_TOOLS,`,并在最后一个 `describe` 内追加:

```ts
  it("buildAttendedArgs is the single argv both launchers hand to claude", () => {
    const args = buildAttendedArgs({ runId: 3, prompt: "P" });
    expect(args).toEqual(["--chrome", "--permission-mode", "dontAsk", "--allowedTools", ...ATTENDED_ALLOWED_TOOLS, "-n", "sortie-run-3", "P"]);
    expect(buildAttendedArgs({ runId: 3, prompt: "P", sessionName: "custom" })).toContain("custom");
    const script = buildExpectScript({ claudeBin: "/c", cwd: "/w", runId: 3, prompt: "P" });
    for (const tool of ATTENDED_ALLOWED_TOOLS) expect(script).toContain(tool);
    expect(script).toContain("-n sortie-run-3");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/executor-attended.test.ts`
Expected: FAIL — `buildAttendedArgs` 不存在。

- [ ] **Step 3: 实现**

在 `src/executor/attended.ts` 中,把 `buildExpectScript` 替换为:

```ts
export interface AttendedArgsOptions {
  runId: number;
  prompt: string;
  sessionName?: string;
}

// The exact argv every launcher (expect on macOS, node-pty / console on Windows) hands to the
// claude binary: Chrome integration on, no permission prompts, only the attended tool allowlist,
// a stable session name per run, and the task prompt as the initial message.
export function buildAttendedArgs(opts: AttendedArgsOptions): string[] {
  return [
    "--chrome",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ...ATTENDED_ALLOWED_TOOLS,
    "-n",
    opts.sessionName ?? `sortie-run-${opts.runId}`,
    opts.prompt,
  ];
}

export function buildExpectScript(opts: { claudeBin: string; cwd: string; runId: number; prompt: string; sessionName?: string }): string {
  const q = (s: string) => `"${s.replace(/[\\"$\[\]]/g, (m) => `\\${m}`)}"`;
  // Plain flag-like tokens stay bare (keeps the script readable and byte-identical to before for
  // them); anything with shell-ish characters or spaces is quoted and escaped for Tcl.
  const qIfNeeded = (s: string) => (/^[A-Za-z0-9_.:/=-]+$/.test(s) ? s : q(s));
  const args = buildAttendedArgs({ runId: opts.runId, prompt: opts.prompt, sessionName: opts.sessionName });
  return [
    `set timeout ${Math.floor(SPAWN_MAX_AGE_MS / 1000)}`,
    `cd ${q(opts.cwd)}`,
    `spawn ${q(opts.claudeBin)} ${args.map(qIfNeeded).join(" ")}`,
    `expect {`,
    `  -re "Enter to confirm" { send "\\r"; exp_continue }`,
    `  timeout { }`,
    `  eof { }`,
    `}`,
    ``,
  ].join("\n");
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/executor-attended.test.ts`
Expected: PASS,包括原有断言 `spawn "/fake/claude" --chrome --permission-mode dontAsk --allowedTools`(这些 token 仍是裸的)与 `say \"hi\" \$x`。

- [ ] **Step 5: Commit**

```bash
git add src/executor/attended.ts tests/executor-attended.test.ts
git commit -m "refactor(executor): buildAttendedArgs — one argv for every attended launcher; expect script consumes it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Windows 拉起器 `attended-win.ts`(node-pty + 控制台兜底)

**Files:**
- Create: `src/executor/attended-win.ts`
- Create: `tests/attended-win.test.ts`

**Interfaces:**
- Produces:
  - `class PromptAnswerer { constructor(patterns?: RegExp[], cooldownMs?: number, keep?: number); feed(chunk: string, now?: number): boolean }`
  - `interface PtyProcess { pid: number; onData(cb: (data: string) => void): void; onExit(cb: (e: { exitCode: number }) => void): void; write(data: string): void }`
  - `interface PtyModule { spawn(file: string, args: string[], opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> }): PtyProcess }`
  - `loadNodePty(requireFn?: (id: string) => unknown): PtyModule`
  - `interface WindowsSpawnOptions { claudeBin: string; args: string[]; cwd: string; logPath: string }`
  - `spawnAttendedPty(opts: WindowsSpawnOptions, deps?: { pty?: PtyModule; env?: NodeJS.ProcessEnv; now?: () => number }): { pid: number }`
  - `type ConsoleSpawnFn = (bin: string, args: string[], opts: { cwd: string; detached: true; stdio: "ignore"; windowsHide: false }) => { pid?: number; unref(): void }`
  - `spawnAttendedConsole(opts: WindowsSpawnOptions, deps?: { spawn?: ConsoleSpawnFn }): { pid: number }`
- Consumes: 无(Task 8 才接线)。

- [ ] **Step 1: 写失败测试 `tests/attended-win.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  PromptAnswerer,
  loadNodePty,
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

describe("loadNodePty", () => {
  it("returns the module when it resolves", () => {
    const fake = { spawn: vi.fn() };
    expect(loadNodePty(() => fake)).toBe(fake);
  });
  it("explains the console fallback when node-pty is missing", () => {
    expect(() => loadNodePty(() => { throw new Error("Cannot find module 'node-pty'"); })).toThrow(/ATTENDED_SPAWN_MODE=console/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/attended-win.test.ts`
Expected: FAIL — 找不到模块 `@/executor/attended-win`。

- [ ] **Step 3: 实现 `src/executor/attended-win.ts`**

```ts
import { spawn as nodeSpawn } from "child_process";
import fs from "fs";
import { createRequire } from "module";

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
export function loadNodePty(requireFn: (id: string) => unknown = createRequire(import.meta.url)): PtyModule {
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
}

export function spawnAttendedPty(
  opts: WindowsSpawnOptions,
  deps: { pty?: PtyModule; env?: NodeJS.ProcessEnv; now?: () => number } = {}
): { pid: number } {
  const pty = deps.pty ?? loadNodePty();
  // node-pty wants a string→string map; drop undefined entries from process.env.
  const env = Object.fromEntries(
    Object.entries(deps.env ?? process.env).filter((kv): kv is [string, string] => typeof kv[1] === "string")
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
  opts: { cwd: string; detached: true; stdio: "ignore"; windowsHide: false }
) => { pid?: number; unref(): void };

export function spawnAttendedConsole(opts: WindowsSpawnOptions, deps: { spawn?: ConsoleSpawnFn } = {}): { pid: number } {
  const spawnFn = deps.spawn ?? (nodeSpawn as unknown as ConsoleSpawnFn);
  // detached on Windows = the child gets its own console window, which is the TTY the TUI needs.
  const child = spawnFn(opts.claudeBin, opts.args, { cwd: opts.cwd, detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
  fs.writeFileSync(opts.logPath, "[attended] console mode: no transcript is captured; follow the run log in the App.\n");
  return { pid: child.pid ?? -1 };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/attended-win.test.ts`
Expected: PASS(8 个用例)。

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无错误(`createRequire(import.meta.url)` 在 `module: esnext` 下合法;若报 `import.meta` 不允许,确认 tsconfig `module` 仍为 `esnext`)。

- [ ] **Step 6: Commit**

```bash
git add src/executor/attended-win.ts tests/attended-win.test.ts
git commit -m "feat(executor): Windows attended launchers — node-pty ConPTY with transcript + auto-Enter, console-window fallback

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 调度器按平台选择拉起器;node-pty 依赖;next.config 外部化;构建验证

**Files:**
- Modify: `src/executor/attended.ts`(`AttendedDeps`、`spawnAttendedSession`)
- Modify: `tests/executor-attended.test.ts`
- Modify: `next.config.ts`
- Modify: `package.json`、`package-lock.json`(`npm install --save-optional node-pty`)

**Interfaces:**
- Consumes: Task 6 `buildAttendedArgs`;Task 7 `spawnAttendedPty` / `spawnAttendedConsole` / `WindowsSpawnOptions`。
- Produces: `type AttendedSpawnMode = "pty" | "console"`;`attendedSpawnModeFromEnv(env?: NodeJS.ProcessEnv): AttendedSpawnMode`;`AttendedDeps` 新增 `platform?: NodeJS.Platform`、`spawnMode?: AttendedSpawnMode`、`spawnWindows?: (mode: AttendedSpawnMode, opts: WindowsSpawnOptions) => { pid: number }`。`spawnExpect` 仍只在非 win32 使用。

- [ ] **Step 1: 先改测试(失败态)**

`tests/executor-attended.test.ts`:
1. import 列表加 `attendedSpawnModeFromEnv,`;新增 `import type { WindowsSpawnOptions } from "@/executor/attended-win";`
2. 三个会 spawn 的既有用例(`"spawns an expect-wrapped claude --chrome …"`、`"does not spawn while a desktop session heartbeats"`、`"reaps a child that died without finishing its run …"`)的 deps 对象里各加 `platform: "darwin" as const,`(Windows 上跑测试时仍走 expect 断言)。
3. 追加:

```ts
  it("on Windows hands the argv to the platform launcher instead of writing an expect script", () => {
    const db = openDb(":memory:");
    const logDir = tmp();
    const run = startExecutor(db, "apply", {}, { logDir }, "user_chrome");
    const calls: { mode: string; opts: WindowsSpawnOptions }[] = [];
    const deps = {
      platform: "win32" as const,
      spawnMode: "pty" as const,
      spawnWindows: (mode: "pty" | "console", opts: WindowsSpawnOptions) => {
        calls.push({ mode, opts });
        return { pid: 9 };
      },
      spawnExpect: () => {
        throw new Error("expect must not be used on win32");
      },
      claudeBin: "C:\\Users\\u\\.local\\bin\\claude.exe",
      logDir,
      cwd: "C:\\sortie",
    };
    expect(dispatchAttended(db, deps).decision.action).toBe("spawn");
    expect(calls).toHaveLength(1);
    expect(calls[0].mode).toBe("pty");
    expect(calls[0].opts.claudeBin).toBe("C:\\Users\\u\\.local\\bin\\claude.exe");
    expect(calls[0].opts.cwd).toBe("C:\\sortie");
    expect(calls[0].opts.args.slice(0, 4)).toEqual(["--chrome", "--permission-mode", "dontAsk", "--allowedTools"]);
    expect(calls[0].opts.args.at(-1)).toContain(`run #${run.id}`);
    expect(calls[0].opts.logPath).toBe(path.join(logDir, `attended-${run.id}.log`));
    expect(fs.existsSync(path.join(logDir, `attended-${run.id}.exp`))).toBe(false);
    expect(currentSpawn(db)).toMatchObject({ pid: 9, runId: run.id, logPath: path.join(logDir, `attended-${run.id}.log`) });
  });

  it("passes the console mode through to the Windows launcher", () => {
    const db = openDb(":memory:");
    const logDir = tmp();
    startExecutor(db, "apply", {}, { logDir }, "user_chrome");
    const modes: string[] = [];
    dispatchAttended(db, { platform: "win32", spawnMode: "console", spawnWindows: (mode) => { modes.push(mode); return { pid: 1 }; }, claudeBin: "C:\\c.exe", logDir, cwd: "C:\\s" });
    expect(modes).toEqual(["console"]);
  });

  it("reads the Windows launcher mode from ATTENDED_SPAWN_MODE (pty unless explicitly console)", () => {
    expect(attendedSpawnModeFromEnv({})).toBe("pty");
    expect(attendedSpawnModeFromEnv({ ATTENDED_SPAWN_MODE: "console" })).toBe("console");
    expect(attendedSpawnModeFromEnv({ ATTENDED_SPAWN_MODE: "bogus" })).toBe("pty");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/executor-attended.test.ts`
Expected: FAIL — `attendedSpawnModeFromEnv` 不存在;win32 用例抛出 "expect must not be used on win32"。

- [ ] **Step 3: 实现**

`src/executor/attended.ts`:
1. 顶部加 `import { spawnAttendedPty, spawnAttendedConsole, type WindowsSpawnOptions } from "@/executor/attended-win";`
2. 把 `AttendedDeps` 及其后的 `spawnAttendedSession` 改为:

```ts
export type AttendedSpawnMode = "pty" | "console";

// Windows launcher choice (see attended-win.ts). pty unless the box opted into the console
// fallback because node-pty could not be installed.
export function attendedSpawnModeFromEnv(env: NodeJS.ProcessEnv = process.env): AttendedSpawnMode {
  return env.ATTENDED_SPAWN_MODE === "console" ? "console" : "pty";
}

export interface AttendedDeps {
  now?: () => Date;
  isAlive?: (pid: number) => boolean;
  spawnExpect?: (scriptPath: string, logPath: string) => { pid: number };
  spawnWindows?: (mode: AttendedSpawnMode, opts: WindowsSpawnOptions) => { pid: number };
  spawnMode?: AttendedSpawnMode;
  platform?: NodeJS.Platform;
  kill?: (pid: number) => void;
  claudeBin?: string;
  logDir?: string;
  cwd?: string;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
function defaultSpawnExpect(scriptPath: string, logPath: string): { pid: number } {
  const fd = fs.openSync(logPath, "a");
  const child = nodeSpawn("expect", ["-f", scriptPath], { detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  return { pid: child.pid ?? -1 };
}
function defaultSpawnWindows(mode: AttendedSpawnMode, opts: WindowsSpawnOptions): { pid: number } {
  return mode === "console" ? spawnAttendedConsole(opts) : spawnAttendedPty(opts);
}

// macOS/Linux: an expect script gives claude a pseudo-tty and answers the first-run prompt.
// Windows: node-pty (or a plain console window) does the same job — see attended-win.ts.
export function spawnAttendedSession(db: DB, runId: number, deps: AttendedDeps = {}): SpawnRecord {
  const now = (deps.now ?? (() => new Date()))();
  const logDir = deps.logDir ?? path.join(process.cwd(), "data/executor-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `attended-${runId}.log`);
  const cwd = deps.cwd ?? process.cwd();
  const claudeBin = deps.claudeBin ?? process.env.ATTENDED_CLAUDE_BIN ?? resolveClaudeBin();
  const prompt = buildAttendedPrompt(runId);
  const platform = deps.platform ?? process.platform;

  let pid: number;
  if (platform === "win32") {
    const mode = deps.spawnMode ?? attendedSpawnModeFromEnv();
    pid = (deps.spawnWindows ?? defaultSpawnWindows)(mode, { claudeBin, args: buildAttendedArgs({ runId, prompt }), cwd, logPath }).pid;
  } else {
    const scriptPath = path.join(logDir, `attended-${runId}.exp`);
    fs.writeFileSync(scriptPath, buildExpectScript({ claudeBin, cwd, runId, prompt }));
    pid = (deps.spawnExpect ?? defaultSpawnExpect)(scriptPath, logPath).pid;
  }
  const rec: SpawnRecord = { pid, runId, startedAt: now.toISOString(), logPath };
  writeKey(db, SPAWN_KEY, rec);
  return rec;
}
```

3. 文件头注释第 11–12 行 "under `expect` (a pseudo-tty; macOS ships expect, no tmux needed)" 后追加 "— on Windows via node-pty / a console window (attended-win.ts) —"。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/executor-attended.test.ts tests/attended-win.test.ts`
Expected: PASS。

- [ ] **Step 5: 安装 node-pty 为可选依赖,外部化**

Run: `npm install --save-optional node-pty`
Expected: `package.json` 出现 `"optionalDependencies": { "node-pty": "^<version>" }`;`npm ls node-pty` 显示已安装(Mac 上会编译或下载预编译包;若编译失败,npm 仍会继续,`npm ls` 会标 `UNMET OPTIONAL` — 记录到 commit message,不阻塞)。

`next.config.ts` 改为:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native modules must stay external to the server bundle: better-sqlite3 always, node-pty is
  // the Windows attended-session launcher (optional dependency, required lazily).
  serverExternalPackages: ["better-sqlite3", "node-pty"],
};

export default nextConfig;
```

- [ ] **Step 6: 全量测试 + 构建**

Run: `npm test`
Expected: 全绿。

Run: `npm run build`
Expected: 构建成功;输出里没有关于 `node-pty` 的 "Module not found"(外部化后即使未安装也只会在运行时 win32 路径报错)。

- [ ] **Step 7: Commit**

```bash
git add src/executor/attended.ts tests/executor-attended.test.ts next.config.ts package.json package-lock.json
git commit -m "feat(executor): attended dispatcher picks node-pty/console on Windows, expect elsewhere; node-pty optional dependency

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 数据库在线备份(库 + 脚本 + npm script)

**Files:**
- Create: `src/lib/backup.ts`
- Create: `scripts/backup-db.ts`
- Create: `tests/backup.test.ts`
- Modify: `package.json`(`scripts.backup`)

**Interfaces:**
- Produces:
  - `AUTO_BACKUP_RE: RegExp`(`/^jobseeker-(\d{4})-(\d{2})-(\d{2})\.db$/`)
  - `backupFileName(day: Date): string` → `jobseeker-YYYY-MM-DD.db`(本地日期)
  - `selectBackupsToPrune(names: string[], today: Date, keepDays: number): string[]`
  - `backupDatabase(opts: { src: string; outDir: string; today?: Date; keepDays?: number }): Promise<{ dest: string; bytes: number; pruned: string[] }>`
  - `npm run backup`(环境:`DATA_DIR`、`BACKUP_KEEP_DAYS`)。Task 10 的 `Sortie Backup` 任务调用它。

- [ ] **Step 1: 写失败测试 `tests/backup.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { openDb } from "@/lib/db";
import { backupFileName, selectBackupsToPrune, backupDatabase } from "@/lib/backup";

describe("backup naming and retention", () => {
  it("names backups by local day and prunes only automated ones older than keepDays", () => {
    const today = new Date(2026, 8, 20); // 2026-09-20 local time
    expect(backupFileName(today)).toBe("jobseeker-2026-09-20.db");
    const names = [
      "jobseeker-2026-09-01.db", // 19 days old → prune
      "jobseeker-2026-09-06.db", // exactly 14 days old → keep
      "jobseeker-2026-09-19.db",
      "jobseeker-2026-09-05-pre-dedup.db", // hand-made: never touched
      "notes.txt",
    ];
    expect(selectBackupsToPrune(names, today, 14)).toEqual(["jobseeker-2026-09-01.db"]);
  });
});

describe("backupDatabase", () => {
  it("writes a consistent copy of a live database and prunes old automated backups", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-"));
    const src = path.join(dir, "jobseeker.db");
    const live = openDb(src); // stays open: simulates the running server
    live.prepare("INSERT INTO profile (key, value) VALUES ('k', 'v')").run();
    const outDir = path.join(dir, "backups");
    fs.mkdirSync(outDir);
    fs.writeFileSync(path.join(outDir, "jobseeker-2020-01-01.db"), "");
    fs.writeFileSync(path.join(outDir, "jobseeker-2020-01-01-manual.db"), "");

    const r = await backupDatabase({ src, outDir, today: new Date(2026, 8, 20), keepDays: 14 });

    expect(r.dest).toBe(path.join(outDir, "jobseeker-2026-09-20.db"));
    expect(r.bytes).toBeGreaterThan(0);
    expect(r.pruned).toEqual(["jobseeker-2020-01-01.db"]);
    expect(fs.existsSync(path.join(outDir, "jobseeker-2020-01-01.db"))).toBe(false);
    expect(fs.existsSync(path.join(outDir, "jobseeker-2020-01-01-manual.db"))).toBe(true);

    const copy = new Database(r.dest, { readonly: true });
    expect(copy.prepare("SELECT value FROM profile WHERE key = 'k'").get()).toEqual({ value: "v" });
    copy.close();
    live.close();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/backup.test.ts`
Expected: FAIL — 找不到模块 `@/lib/backup`。

- [ ] **Step 3: 实现 `src/lib/backup.ts`**

```ts
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

// Daily online backup of data/jobseeker.db (spec §3: the Windows box is the only copy of the data).
// Uses SQLite's backup API through better-sqlite3, so it is consistent even while the server is
// writing, and prunes the automated backups older than keepDays. Hand-made backups (any other
// file name, e.g. jobseeker-2026-09-05-pre-dedup.db) are never touched.

export const AUTO_BACKUP_RE = /^jobseeker-(\d{4})-(\d{2})-(\d{2})\.db$/;

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function backupFileName(day: Date): string {
  return `jobseeker-${localDay(day)}.db`;
}

export function selectBackupsToPrune(names: string[], today: Date, keepDays: number): string[] {
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays);
  return names.filter((n) => {
    const m = AUTO_BACKUP_RE.exec(n);
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d < cutoff;
  });
}

export interface BackupOptions {
  src: string;
  outDir: string;
  today?: Date;
  keepDays?: number;
}
export interface BackupResult {
  dest: string;
  bytes: number;
  pruned: string[];
}

export async function backupDatabase(opts: BackupOptions): Promise<BackupResult> {
  const today = opts.today ?? new Date();
  const keepDays = opts.keepDays ?? 14;
  fs.mkdirSync(opts.outDir, { recursive: true });
  const dest = path.join(opts.outDir, backupFileName(today));
  const db = new Database(opts.src, { fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
  const pruned = selectBackupsToPrune(fs.readdirSync(opts.outDir), today, keepDays);
  for (const n of pruned) fs.unlinkSync(path.join(opts.outDir, n));
  return { dest, bytes: fs.statSync(dest).size, pruned };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/backup.test.ts`
Expected: PASS。

- [ ] **Step 5: 脚本与 npm script**

`scripts/backup-db.ts`:

```ts
import path from "path";
import { backupDatabase } from "../src/lib/backup";

// Daily database backup. Windows: the `Sortie Backup` scheduled task runs this at 04:00
// (ops/windows/setup.ps1); anywhere: `npm run backup`. Online snapshot — the server keeps running.
async function main() {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  const keepDays = Number(process.env.BACKUP_KEEP_DAYS || 14);
  const r = await backupDatabase({ src: path.join(dataDir, "jobseeker.db"), outDir: path.join(dataDir, "backups"), keepDays });
  console.log(`backup written: ${r.dest} (${(r.bytes / 1024 / 1024).toFixed(1)} MB); pruned ${r.pruned.length}: ${r.pruned.join(", ") || "-"}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

`package.json` 的 `scripts` 里 `"retier"` 之后加:

```json
    "backup": "tsx scripts/backup-db.ts"
```

- [ ] **Step 6: 冒烟(用临时 DATA_DIR,不碰真库)**

Run(scratch 目录见环境说明,这里用 `$SCRATCH` 代指):
```bash
SCRATCH="${TMPDIR:-/tmp}/sortie-backup-smoke"; mkdir -p "$SCRATCH"
npx tsx -e "import('./src/lib/db').then(m => { m.openDb('$SCRATCH/jobseeker.db').close(); })"
DATA_DIR="$SCRATCH" npm run backup
ls "$SCRATCH/backups"
```
Expected: 打印 `backup written: …/backups/jobseeker-<今天>.db (… MB); pruned 0: -`,目录里有该文件。

- [ ] **Step 7: Commit**

```bash
git add src/lib/backup.ts scripts/backup-db.ts tests/backup.test.ts package.json
git commit -m "feat: daily online SQLite backup (npm run backup) with 14-day retention of automated copies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Windows 运维文件 `ops/windows/`(pm2、部署、一次性设置、Chrome、Caddy)

**Files:**
- Create: `ops/windows/ecosystem.config.cjs`
- Create: `ops/windows/deploy.ps1`
- Create: `ops/windows/setup.ps1`
- Create: `ops/windows/start-chrome.cmd`
- Create: `ops/windows/Caddyfile`

**Interfaces:**
- Consumes: `npm run backup`(Task 9);`GET /api/executor/dispatch`(返回 `{heartbeat, spawn:{pid,runId,startedAt,logPath,alive}|null}`)与 `GET /api/executor/status`(返回 `{runs:[{id,kind,status,channel,…}]}`),两者已存在。
- Produces: 任务计划名 `Sortie Server` / `Sortie Chrome` / `Sortie Backup` / `Sortie Caddy`;防火墙规则名 `Sortie Caddy (tailnet only)`;pm2 应用名 `sortie`;`.env` 键 `CF_API_TOKEN`、`TS_IP`(Caddyfile 用)。

- [ ] **Step 1: `ops/windows/ecosystem.config.cjs`**

```js
// pm2 definition for the Sortie server on Windows (spec §2).
// First start (once):  pm2 start ops\windows\ecosystem.config.cjs --only sortie && pm2 save
// Every logon after:   the `Sortie Server` scheduled task runs the same `pm2 start` (idempotent).
// Runs Next's bin directly instead of `npm start`: pm2 + npm.cmd shims leave orphaned node
// processes behind on restart on Windows. TZ is pinned here (not in .env) because Node reads TZ
// at process start, before Next loads .env.
const path = require("path");
const root = path.resolve(__dirname, "..", "..");

module.exports = {
  apps: [
    {
      name: "sortie",
      cwd: root,
      script: path.join(root, "node_modules", "next", "dist", "bin", "next"),
      args: "start -H 127.0.0.1 -p 3000",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      kill_timeout: 10000,
      out_file: path.join(root, "data", "pm2-out.log"),
      error_file: path.join(root, "data", "pm2-err.log"),
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
        TZ: "America/Los_Angeles",
        PORT: "3000",
      },
    },
  ],
};
```

- [ ] **Step 2: 验证 ecosystem 可加载**

Run: `node -e 'const c=require("./ops/windows/ecosystem.config.cjs"); const a=c.apps[0]; if(a.name!=="sortie"||!a.script.endsWith("next")||a.env.TZ!=="America/Los_Angeles") process.exit(1); console.log("ok", a.script)'`
Expected: 打印 `ok <绝对路径>/node_modules/next/dist/bin/next`。

- [ ] **Step 3: `ops/windows/start-chrome.cmd`**

```bat
@echo off
rem Opens the job-hunting Chrome profile at logon so the Claude in Chrome extension is connected
rem and the attended session can drive it (spec §2). Set PROFILE to the "Profile Path" folder
rem name shown at chrome://version for that profile (e.g. Default, Profile 1, Profile 2).
set "PROFILE=Default"
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo Chrome not found under Program Files or LocalAppData & exit /b 1
)
start "" "%CHROME%" --profile-directory="%PROFILE%"
```

- [ ] **Step 4: `ops/windows/Caddyfile`**

```
# Sortie behind Caddy on the Windows box (spec §1, phase 2 — custom domain).
# Only the Tailscale interface is bound, so the site is reachable from the user's own devices and
# from nothing else. Fill in the domain below; put TS_IP (this machine's 100.x Tailscale address)
# and CF_API_TOKEN (Cloudflare token scoped to Zone:DNS:Edit for this zone) into C:\sortie\.env.
# The `Sortie Caddy` task runs: caddy run --config ops\windows\Caddyfile --envfile C:\sortie\.env
# Requires a Caddy build with the cloudflare DNS module (caddyserver.com/download → dns.providers.cloudflare).
{
	admin off
}

sortie.example.com {
	bind {$TS_IP}
	tls {
		dns cloudflare {env.CF_API_TOKEN}
	}
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
	log {
		output file C:/sortie/data/caddy-access.log {
			roll_size 20MiB
			roll_keep 5
		}
	}
}
```

- [ ] **Step 5: `ops/windows/deploy.ps1`**

```powershell
<#
.SYNOPSIS
  Deploy the checked-out branch on the Windows box (spec §2). Replaces the macOS
  `npm run build && launchctl kickstart ...` step.
.DESCRIPTION
  Refuses to restart while an attended session the server spawned is alive, or a user_chrome
  run is running (restarting pm2 would kill the claude child it launched). -Force skips the guard.
  Steps: git pull --ff-only -> npm ci -> npm run build -> pm2 restart sortie -> wait for the API.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\deploy.ps1
  powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\deploy.ps1 -Force
#>
[CmdletBinding()]
param(
  [switch]$Force,
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$Base = "http://127.0.0.1:3000"
)
$ErrorActionPreference = "Stop"
Set-Location $Root

function Get-Json($url) {
  try { return Invoke-RestMethod -Uri $url -TimeoutSec 5 } catch { return $null }
}

if (-not $Force) {
  $attended = Get-Json "$Base/api/executor/dispatch"
  $status = Get-Json "$Base/api/executor/status"
  $spawnAlive = [bool]($attended -and $attended.spawn -and $attended.spawn.alive)
  $running = @()
  if ($status -and $status.runs) {
    $running = @($status.runs | Where-Object { $_.channel -eq "user_chrome" -and $_.status -eq "running" })
  }
  if ($spawnAlive -or $running.Count -gt 0) {
    Write-Host "Refusing to deploy: attended work in progress (spawned session alive: $spawnAlive; running user_chrome runs: $($running.Count))." -ForegroundColor Yellow
    Write-Host "Wait for it to finish, or re-run with -Force." -ForegroundColor Yellow
    exit 2
  }
}

Write-Host "==> git pull --ff-only"
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull failed" }

Write-Host "==> npm ci"
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

Write-Host "==> npm run build"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed - server NOT restarted. .next may be partially overwritten: fix the build and re-run." }

Write-Host "==> pm2 restart sortie"
pm2 restart sortie --update-env
if ($LASTEXITCODE -ne 0) { throw "pm2 restart failed (is the app registered? pm2 start ops\windows\ecosystem.config.cjs --only sortie)" }

$deadline = (Get-Date).AddSeconds(60)
$ok = $null
do {
  Start-Sleep -Seconds 2
  $ok = Get-Json "$Base/api/executor/status"
} until ($ok -or (Get-Date) -gt $deadline)
if (-not $ok) { throw "server did not answer on $Base within 60s - check: pm2 logs sortie" }

$sha = git rev-parse --short HEAD
$subject = git log -1 --pretty=%s
Write-Host "==> deployed $sha : $subject" -ForegroundColor Green
```

- [ ] **Step 6: `ops/windows/setup.ps1`**

```powershell
#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-time (and safely repeatable) Windows box setup for Sortie (spec §2): logon tasks, the daily
  backup task, Defender exclusions, power settings and, with -WithCaddy, the tailnet-only firewall rule.
.DESCRIPTION
  Every step replaces what it created before, so re-running is fine. This script never asks for
  or stores a password: automatic logon is configured by you with Sysinternals Autologon.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\setup.ps1
  powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\setup.ps1 -WithCaddy -CaddyExe C:\caddy\caddy.exe
#>
[CmdletBinding()]
param(
  [string]$Root = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
  [string]$User = "$env:USERDOMAIN\$env:USERNAME",
  [switch]$WithCaddy,
  [string]$CaddyExe = "C:\caddy\caddy.exe",
  [switch]$SkipPower
)
$ErrorActionPreference = "Stop"

function Resolve-Cmd($name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $c) { throw "$name not found on PATH - install it first (see ops\windows\README.md)" }
  return $c.Source
}

$pm2 = Resolve-Cmd "pm2.cmd"
$npm = Resolve-Cmd "npm.cmd"
$ecosystem = Join-Path $Root "ops\windows\ecosystem.config.cjs"
$chromeCmd = Join-Path $Root "ops\windows\start-chrome.cmd"
$caddyfile = Join-Path $Root "ops\windows\Caddyfile"
$envFile = Join-Path $Root ".env"
New-Item -ItemType Directory -Force -Path (Join-Path $Root "data") | Out-Null

# Everything runs inside the interactive desktop session of $User: that is where Chrome and the
# attended claude sessions live. Never "run whether user is logged on or not" (that is session 0).
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
$longRunning = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$oneShot = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

function Register-SortieTask($name, $action, $trigger, $settings) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
  Write-Host "[task] $name registered"
}

function New-LogonTrigger($delaySeconds) {
  $t = New-ScheduledTaskTrigger -AtLogOn -User $User
  $t.Delay = "PT${delaySeconds}S"
  return $t
}

# 1. Server: pm2 brings up `sortie` from the ecosystem file (an already-running app is left alone).
Register-SortieTask "Sortie Server" `
  (New-ScheduledTaskAction -Execute $pm2 -Argument "start `"$ecosystem`" --only sortie" -WorkingDirectory $Root) `
  (New-LogonTrigger 20) $longRunning

# 2. Chrome with the job-hunting profile, so the Claude in Chrome extension is connected.
Register-SortieTask "Sortie Chrome" `
  (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$chromeCmd`"" -WorkingDirectory $Root) `
  (New-LogonTrigger 30) $oneShot

# 3. Daily online backup at 04:00 local (scripts/backup-db.ts via `npm run backup`).
Register-SortieTask "Sortie Backup" `
  (New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"cd /d `"$Root`" && `"$npm`" run backup >> data\backup.log 2>&1`"" -WorkingDirectory $Root) `
  (New-ScheduledTaskTrigger -Daily -At 4:00AM) $oneShot

# 4. Caddy (phase 2, custom domain) — only with -WithCaddy.
if ($WithCaddy) {
  if (-not (Test-Path $CaddyExe)) { throw "Caddy not found at $CaddyExe (download a build with the cloudflare DNS module - see README)" }
  Register-SortieTask "Sortie Caddy" `
    (New-ScheduledTaskAction -Execute $CaddyExe -Argument "run --config `"$caddyfile`" --envfile `"$envFile`"" -WorkingDirectory $Root) `
    (New-LogonTrigger 25) $longRunning
  Remove-NetFirewallRule -DisplayName "Sortie Caddy (tailnet only)" -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "Sortie Caddy (tailnet only)" -Direction Inbound -Action Allow `
    -Program $CaddyExe -Protocol TCP -LocalPort 443 -RemoteAddress 100.64.0.0/10 -Profile Any | Out-Null
  Write-Host "[firewall] inbound 443 to caddy.exe allowed from 100.64.0.0/10 only"
} else {
  Unregister-ScheduledTask -TaskName "Sortie Caddy" -Confirm:$false -ErrorAction SilentlyContinue
}

# 5. Defender: keep real-time scanning off the database and node_modules (file locks + speed).
Add-MpPreference -ExclusionPath (Join-Path $Root "data"), (Join-Path $Root "node_modules")
Write-Host "[defender] excluded $Root\data and $Root\node_modules"

# 6. Power: an always-on box. The monitor may sleep; the machine may not.
if (-not $SkipPower) {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  powercfg /change monitor-timeout-ac 15
  powercfg /hibernate off
  powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
  powercfg /setactive SCHEME_CURRENT
  Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power" -Name HiberbootEnabled -Value 0 -Type DWord
  Write-Host "[power] never sleep on AC; hibernate and fast startup off; lid close does nothing"
}

Write-Host ""
Write-Host "Done. Remaining manual steps (details in ops\windows\README.md):" -ForegroundColor Green
Write-Host "  1. Autologon (Sysinternals) so the desktop session exists after every reboot."
Write-Host "  2. First start now:  pm2 start `"$ecosystem`" --only sortie ; pm2 save"
Write-Host "  3. tailscale serve --bg 3000   (phase 1 URL: https://<machine>.<tailnet>.ts.net)"
Write-Host "  4. Set PROFILE= in ops\windows\start-chrome.cmd to the job-hunting Chrome profile folder."
```

- [ ] **Step 7: 验证(Mac 上能做的部分)**

这台 Mac 没有 PowerShell(`pwsh`),`.ps1` 的语法与 Task Scheduler 调用只能在 Windows 上验证(runbook 第 4 节的第一步就是跑 `setup.ps1`)。Mac 上做两件事:
- `node -e 'require("./ops/windows/ecosystem.config.cjs")'` 仍然通过;
- `grep -c 'Register-SortieTask "' ops/windows/setup.ps1` 输出 `4`(四个任务都在)。

- [ ] **Step 8: Commit**

```bash
git add ops/windows/ecosystem.config.cjs ops/windows/deploy.ps1 ops/windows/setup.ps1 ops/windows/start-chrome.cmd ops/windows/Caddyfile
git commit -m "ops(windows): pm2 ecosystem, guarded deploy.ps1, idempotent setup.ps1 (logon tasks, backup task, firewall, Defender, power), Chrome launcher, Caddyfile template

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: 文档:`.env.example`、runbook、README、CLAUDE.md、spec 端点修正

**Files:**
- Modify: `.env.example`
- Create: `ops/windows/README.md`
- Modify: `README.md`(启动节之后新增「Windows 常开机部署」;`claude` 二进制段落补 Windows)
- Modify: `CLAUDE.md`(§2 部署行、§3 前置与 §3.0、§4.4)
- Modify: `docs/superpowers/specs/2026-09-06-windows-server-migration-design.md`(两处端点名)

**Interfaces:**
- Consumes: Task 8 的 `ATTENDED_SPAWN_MODE`、Task 5 的 `CHROME_BIN`、Task 1 的 `PDFTOTEXT_BIN`、Task 9 的 `BACKUP_KEEP_DAYS`、Task 10 的 `CF_API_TOKEN` / `TS_IP` 与脚本名。

- [ ] **Step 1: `.env.example` 追加**

在文件末尾追加:

```
# ---- Windows 常开机(spec docs/superpowers/specs/2026-09-06-windows-server-migration-design.md)----
# 非 macOS 没有桌面通知,NTFY_TOPIC 是唯一通知通道:Windows 上务必配置(上面的 NTFY_TOPIC)。
# Chrome 可执行文件绝对路径(可选)。/apply「打开浏览器档案」用它拉起无头通道的 Chrome 档案;
# 不设则按平台探测(macOS 的 Chrome.app;Windows 的 Program Files / LocalAppData)。
CHROME_BIN=
# pdftotext(poppler)可执行文件路径(可选)。不设则用 PATH 里的 pdftotext;缺了只是跳过简历自检。
PDFTOTEXT_BIN=
# 仅 Windows:值守会话的拉起方式。默认 pty(node-pty 伪终端,有转录和自动回车);node-pty 装不上时设 console。
ATTENDED_SPAWN_MODE=
# 自动备份(npm run backup / Windows 的 Sortie Backup 任务)保留天数,默认 14。
BACKUP_KEEP_DAYS=
# 仅 Windows 阶段 2(自定义域名,Caddy 用):Cloudflare API token(只给该域 Zone:DNS:Edit)和本机 Tailscale IPv4。
CF_API_TOKEN=
TS_IP=
```

- [ ] **Step 2: 写 runbook `ops/windows/README.md`**

```markdown
# Sortie 在 Windows 常开机上的部署与切换 runbook

设计:`docs/superpowers/specs/2026-09-06-windows-server-migration-design.md`。本文是按顺序照做的操作手册。
硬原则:**SQLite 单写者**——第 6 节切换之前 Mac 的服务器照常跑;切换之后 Mac 上绝不再启动它。

## 0. 前提
- Windows 11(x64)、本机管理员;Claude Pro/Max 直连账号;Tailscale 账号;一个 Google 账号(Chrome Remote Desktop)。
- 仓库已推到 GitHub 私有仓(在 Mac 主仓库执行一次:`gh auth login` → `gh repo create sortie --private --source=. --remote=origin --push`)。

## 1. 装软件(管理员 PowerShell)
```powershell
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Git.Git -e
winget install --id Google.Chrome -e
winget install --id Tailscale.Tailscale -e
winget install --id jqlang.jq -e
winget install --id Microsoft.Sysinternals.Autologon -e
winget install --id oschwartz10612.Poppler -e     # 可选:pdftotext,简历自检用
```
- tectonic:`winget install --id TectonicTypesetting.Tectonic -e`;winget 里找不到就从 GitHub Releases 下载 `tectonic.exe` 放进 PATH 目录(如 `C:\tools`),或 `scoop install tectonic`。
- **新开一个终端**(让 PATH 生效),然后:`npm i -g pm2`、`git config --global core.autocrlf false`、`tzutil /s "Pacific Standard Time"`。
- Claude Code 原生安装:`irm https://claude.ai/install.ps1 | iex`,新终端里 `claude --version` 能出版本;装到 `%USERPROFILE%\.local\bin\claude.exe`。
- Chrome Remote Desktop:在 Windows 的 Chrome 打开 remotedesktop.google.com/access → 设置远程访问 → 装被控端、设 PIN。Mac 上用同一 Google 账号在浏览器里连。
- Claude 桌面 App(可选,开发用)照常安装。
- 可选:OpenSSH 服务端(设置 → 系统 → 可选功能 → 添加「OpenSSH 服务器」,然后 `Set-Service sshd -StartupType Automatic; Start-Service sshd`),Mac 终端经 Tailscale `ssh <用户>@<Tailscale IP>` 做纯命令行的事。

## 2. 仓库与 .env
```powershell
git clone https://github.com/<你的账号>/sortie.git C:\sortie
cd C:\sortie
npm ci
npm test
npm run build
copy .env.example .env
copy profile\profile.example.yaml profile\profile.yaml
```
- `npm ci` 输出里确认 `better-sqlite3` 与 `node-pty` 用了预编译包;若 `node-pty` 编译失败(没有 VS Build Tools),不用管——在 `.env` 里设 `ATTENDED_SPAWN_MODE=console`。
- `.env` 至少填:`NTFY_TOPIC=<长随机串>`;**演练期先加** `SCAN_TICK_DISABLED=1` 和 `ATTENDED_DISPATCH_DISABLED=1`(避免和 Mac 同时扫描、同时烧 `claude -p` 配额)。
- iPhone 装 ntfy app 订阅这个 topic;Mac 浏览器打开 ntfy.sh/app 订阅同名 topic 并允许通知。

## 3. Claude 与 Chrome 一次性准备
1. Chrome 里新建「求职」档案,手动登录 LinkedIn / Workday / Handshake / Google;装 Claude in Chrome 扩展并登录 Claude 账号。`chrome://version` 看 Profile Path 最后一段(如 `Profile 2`),写进 `ops\windows\start-chrome.cmd` 的 `PROFILE=`。
2. 终端:`claude` → `/login`(浏览器 OAuth,选 Pro/Max 账号)。
3. 在 `C:\sortie` 里跑一次 `claude --chrome`:点掉首次介绍框、目录信任框;`/chrome` 应显示 Status: Enabled、Extension: Installed;`/exit`。这样调度器自动拉起的会话不会卡在首次提示上。

## 4. 一次性设置、pm2 首启、Tailscale Serve
```powershell
powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\setup.ps1     # 管理员
pm2 start C:\sortie\ops\windows\ecosystem.config.cjs --only sortie
pm2 save
pm2 logs sortie --lines 50          # 应看到 "[jobseeker] scheduler registered"
tailscale up
tailscale serve --bg 3000
tailscale serve status
```
- Tailscale 管理台(login.tailscale.com/admin/dns):开 MagicDNS 和 HTTPS Certificates。Mac(已装 Tailscale)打开 `https://<机名>.<tailnet>.ts.net` 应看到 App。
- 自动登录:运行 Autologon.exe,填当前用户与密码 → Enable(它把密码存为 LSA secret;任何脚本都不碰密码)。
- 重启一次 Windows,确认:自动登录 → `pm2 status` 里 `sortie` online → Chrome 已开 → 网址可达。

## 5. 演练(用数据副本,Mac 不停机)
Mac 上:
```bash
cd /Users/moka/Documents/job_seeker
sqlite3 data/jobseeker.db ".backup 'data/backups/migrate-$(date +%F).db'"
tar czf ~/sortie-migrate.tgz -C data/backups migrate-$(date +%F).db -C /Users/moka/Documents/job_seeker profile/profile.yaml data/resumes
tailscale file cp ~/sortie-migrate.tgz <windows-机名>:
```
Windows 上(Taildrop 文件落在「下载」;CLI 版用 `tailscale file get $env:USERPROFILE\Downloads`):
```powershell
pm2 stop sortie
cd C:\sortie
tar -xzf $env:USERPROFILE\Downloads\sortie-migrate.tgz -C C:\sortie
Move-Item -Force C:\sortie\migrate-*.db C:\sortie\data\jobseeker.db
Remove-Item -ErrorAction SilentlyContinue C:\sortie\data\jobseeker.db-wal, C:\sortie\data\jobseeker.db-shm
pm2 restart sortie --update-env
```
验证:Mac 浏览器过一遍 /queue /apply /history /network /dashboard;/resume 生成一份 PDF(tectonic);/queue 点「补判内推建议」后 `pm2 logs sortie` 没有 "claude CLI not found";`npm run backup` 成功。

## 6. 切换日(约 30 分钟停机)
Mac 上:
```bash
launchctl bootout gui/$(id -u)/com.jobseeker.os
mv ~/Library/LaunchAgents/com.jobseeker.os.plist ~/Documents/job_seeker/data/backups/   # 防止开机自启
pgrep -fl "next start" || echo "mac server stopped"
cd /Users/moka/Documents/job_seeker && sqlite3 data/jobseeker.db ".backup 'data/backups/final-$(date +%F).db'"
tailscale file cp data/backups/final-$(date +%F).db <windows-机名>:
```
Windows 上:`pm2 stop sortie` → 用 `final-*.db` 覆盖 `C:\sortie\data\jobseeker.db`(同上删 -wal/-shm)→ `.env` 去掉 `SCAN_TICK_DISABLED` 与 `ATTENDED_DISPATCH_DISABLED` → `pm2 restart sortie --update-env`。
核对:/queue 漏斗计数与 Mac 最后一次一致;`pm2 logs sortie` 每分钟出现 scan tick;做一个会发通知的动作(如让一次 needs_info 发生,或 `curl -d test https://ntfy.sh/<topic>`)手机与 Mac 都收到。

## 7. 验收清单
- [ ] `npm test` 在 Windows 全绿。
- [ ] ts.net 网址在 Mac 与手机都能开。
- [ ] 匹配分数持续产出(/queue 新岗有分;`matches` 行数增长);/sources 各家族「24h 出错」正常。
- [ ] **核心**:Claude 桌面 App 关着 → App 点「开始投递」→ 10 秒内执行器面板显示 spawn → run 日志出现接单 → Windows Chrome 开始填表 → Mac 上确认 → 提交成功。
- [ ] 重启演练:Windows 重启 → 自动登录 → pm2、Chrome 自动起来 → 网址 2 分钟内恢复。
- [ ] 次日 `C:\sortie\data\backups\` 里出现 `jobseeker-<日期>.db`。

## 8. 阶段 2:自定义域名(随时做,不阻塞以上)
1. Cloudflare Registrar 买域名。DNS 加 A 记录:`sortie` → `tailscale ip -4` 的地址,**Proxy status = DNS only(灰云)**。
2. Cloudflare → My Profile → API Tokens → Create Token → 模板 "Edit zone DNS",只勾这一个 zone。写入 `.env`:`CF_API_TOKEN=<token>`、`TS_IP=<100.x.x.x>`。
3. caddyserver.com/download:平台 windows/amd64,勾插件 `dns.providers.cloudflare`,下载到 `C:\caddy\caddy.exe`。
4. 把 `ops\windows\Caddyfile` 里的 `sortie.example.com` 改成你的域名;`C:\caddy\caddy.exe validate --config C:\sortie\ops\windows\Caddyfile --envfile C:\sortie\.env` 通过。
5. `tailscale serve off`(443 让给 Caddy)→ 管理员:`powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\setup.ps1 -WithCaddy -CaddyExe C:\caddy\caddy.exe` → `Start-ScheduledTask "Sortie Caddy"`。
6. Mac 打开 `https://sortie.<域名>`。首次签证书要几十秒;看 `C:\sortie\data\caddy-access.log` 与 `Get-ScheduledTaskInfo "Sortie Caddy"`。

## 9. 日常运维
- 部署:`powershell -ExecutionPolicy Bypass -File C:\sortie\ops\windows\deploy.ps1`(有值守会话在跑会拒绝;确认无事后 `-Force`)。
- 状态/日志:`pm2 status`、`pm2 logs sortie`、`C:\sortie\data\pm2-*.log`、值守会话转录 `C:\sortie\data\executor-logs\attended-<run>.log`。
- 备份:自动每天 04:00;手动 `npm run backup`;每周把最新一份 Taildrop 到 Mac 一次。
- Claude 登录失效(值守会话日志 "extension not connected" / 403):终端 `claude` → `/login`;扩展掉线:`/chrome` → Reconnect extension。
- Windows 更新重启后:看 `pm2 status` 与网址;`tzutil /g` 仍是 Pacific Standard Time。
- 值守会话起不来且日志提到 node-pty:`.env` 设 `ATTENDED_SPAWN_MODE=console`,`pm2 restart sortie --update-env`。

## 10. 回滚(切换后两周内)
Windows `pm2 stop sortie`;把 Windows 最新备份拷回 Mac 的 `data/jobseeker.db`;Mac 把 plist 移回 `~/Library/LaunchAgents/` 并 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jobseeker.os.plist`。两周稳定后再清 Mac 的 `data/`(留一份 zip 归档)。
```

- [ ] **Step 3: README 增补**

在 `README.md` 的「## 自动扫描(信息源层,2026-09-06 起)」之前插入:

```markdown
## Windows 常开机部署
生产环境跑在一台常开的 Windows 11 机器上,Mac/手机经 Tailscale 用浏览器访问(设计 `docs/superpowers/specs/2026-09-06-windows-server-migration-design.md`,操作手册 `ops/windows/README.md`)。要点:pm2 + 任务计划「用户登录时」常驻(不是 Windows 服务,服务碰不到 Chrome);部署用 `powershell -ExecutionPolicy Bypass -File ops\windows\deploy.ps1`;通知只走 ntfy(`NTFY_TOPIC` 必填);值守会话由 node-pty 代替 expect 拉起(`ATTENDED_SPAWN_MODE=console` 兜底);每天 04:00 自动备份到 `data/backups/`(`npm run backup`)。
```

并把「**`claude` 二进制路径:**」段落末尾追加一句:"Windows 上原生安装器把它装在 `%USERPROFILE%\.local\bin\claude.exe`,`resolveClaudeBin()` 同样会探测到。"

- [ ] **Step 4: CLAUDE.md 三处修改**

1. §2 末行 "- 改代码后部署:`npm run build && launchctl kickstart -k gui/$(id -u)/com.jobseeker.os`。dev 模式 `npm run dev` 也能用。测试 `npm test`。" 改为:
   "- 改代码后部署:Mac(切换前)`npm run build && launchctl kickstart -k gui/$(id -u)/com.jobseeker.os`;Windows(切换后)`powershell -ExecutionPolicy Bypass -File ops\windows\deploy.ps1`(有值守会话在跑会拒绝,`-Force` 跳过)。dev 模式 `npm run dev` 也能用。测试 `npm test`。"
2. §3 前置那一行末尾(…所以必须是交互会话。)追加:"切换到 Windows 常开机后,值守会话必须是 **Windows 上的**会话(桌面 App 或调度器拉起的 CLI);Mac 上的会话连的是 Mac 本机 3000,不再是值守会话。"
   §3.0 中 "服务器用 `expect` 拉起终端版 `claude --chrome --permission-mode dontAsk --allowedTools …`(提示词见 `buildAttendedPrompt`)" 之后插入 ";Windows 上由 node-pty(ConPTY)代替 expect(`src/executor/attended-win.ts`),`ATTENDED_SPAWN_MODE=console` 兜底"。
3. §4 第 4 条整条替换为:
   "4. 部署迁移到 **Windows 常开机**:设计 spec `docs/superpowers/specs/2026-09-06-windows-server-migration-design.md`、计划 `docs/superpowers/plans/2026-09-08-windows-server-migration.md`、操作手册 `ops/windows/README.md`。代码侧已完成(平台分支:notify/killTree/claude-bin/open-profile/attended-win;`ops/windows/` 脚本;每日备份)。**切换尚未发生**:Mac 的 launchd 服务仍是生产。待办按 runbook:GitHub 私有仓 → Windows 装机 → 演练 → 切换日 → 验收 → 阶段 2 域名(Caddy)。切换完成后把本条改成已完成并更新 §0。"

- [ ] **Step 5: spec 端点名修正**

`docs/superpowers/specs/2026-09-06-windows-server-migration-design.md`:
- §2 部署第 1 点 "守卫:`GET /api/executor/status`,若 `attended.spawn.alive` 或有 `channel=user_chrome` 且 `status=running` 的 run" 改为 "守卫:`GET /api/executor/dispatch` 的 `spawn.alive` 为真,或 `GET /api/executor/status` 里有 `channel=user_chrome` 且 `status=running` 的 run"。
- §3 表格 attended.ts 行末 "deploy 守卫依赖 status 已有的 `attended.spawn.alive`。" 改为 "deploy 守卫读 `GET /api/executor/dispatch` 的 `spawn.alive` 与 `GET /api/executor/status` 的 runs。"

- [ ] **Step 6: 检查文档里引用的键与脚本名都存在**

Run:
```bash
for k in CHROME_BIN PDFTOTEXT_BIN ATTENDED_SPAWN_MODE BACKUP_KEEP_DAYS CF_API_TOKEN TS_IP; do grep -q "^$k=" .env.example && echo "ok $k" || echo "MISSING $k"; done
ls ops/windows/README.md ops/windows/deploy.ps1 ops/windows/setup.ps1 ops/windows/ecosystem.config.cjs ops/windows/start-chrome.cmd ops/windows/Caddyfile
grep -c "attended-win" CLAUDE.md README.md
```
Expected: 六个 `ok`;六个文件都在;两份文档各至少 1 次提到 `attended-win`。

- [ ] **Step 7: Commit**

```bash
git add .env.example ops/windows/README.md README.md CLAUDE.md docs/superpowers/specs/2026-09-06-windows-server-migration-design.md
git commit -m "docs: Windows runbook (install → rehearsal → cutover → acceptance → domain), env keys, README/CLAUDE.md deploy + attended notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 收尾验证

**Files:** 无新改动(只验证)。

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全绿(原 686 + 本计划新增约 25 个用例)。

- [ ] **Step 2: 类型与构建**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 无类型错误;构建成功。

- [ ] **Step 3: 工作区干净、提交序列完整**

Run: `git status --short && git log --oneline main..HEAD`
Expected: 工作区干净;分支上有 Task 1–11 的 11 次提交加上 spec/plan 的 docs 提交。

- [ ] **Step 4: 汇报**

向用户说明:代码侧完成、Mac 行为不变、Windows 侧按 `ops/windows/README.md` 执行;明确列出只能在 Windows 上验证的项(node-pty 安装、`setup.ps1` / `deploy.ps1` 语法与任务计划、真机值守会话拉起、重启自愈)。合并到 main 的方式按 superpowers:finishing-a-development-branch 处理。
