import { spawn as nodeSpawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { DB } from "@/lib/db";
import { buildApplyPrompt, buildNetworkSendPrompt, buildNetworkFindPrompt, ApplyPlanEntry } from "@/executor/prompts";

// The process manager for headless `claude -p` executor sessions launched from the App's UI.
// See docs on the API routes (src/app/api/executor/*) and README's 投递执行/人脉 sections for the
// end-to-end picture: the user clicks a button in the App, this module spawns a detached
// `claude -p` process wired to prompts.ts's prompt for the requested kind, and the App polls
// executorStatus() to show progress until the process exits.

export type ExecutorKind = "apply" | "network_send" | "network_find";

export interface StartOptions {
  limit?: number;
  companies?: string[];
  // apply kind only — per-direction quota plan, processed in order. See buildApplyPrompt.
  plan?: ApplyPlanEntry[];
}

// A structural subset of child_process.ChildProcess — deliberately loose so tests can inject a
// fake without pulling in real child_process types. Node's actual ChildProcess satisfies this.
export interface SpawnedChild {
  pid?: number;
  stdin?: { write: (chunk: string) => void; end: () => void } | null;
  on(event: "exit", listener: (code: number | null) => void): unknown;
  unref(): void;
}

export type SpawnFn = (
  bin: string,
  args: string[],
  opts: { cwd: string; detached: boolean; stdio: [string, number, number] }
) => SpawnedChild;

export interface RunnerDeps {
  spawn?: SpawnFn;
  logDir?: string;
}

const ALLOWED_TOOLS = "Bash(curl:*),mcp__playwright__*";

// launchd's PATH for the prod server process includes /opt/homebrew/bin but not ~/.local/bin,
// where the `claude` CLI actually lives on this machine — so a bare 'claude' spawn fails under
// launchd even though it works fine from an interactive shell. Resolve explicitly: an env
// override always wins, then the known install path, then fall back to bare 'claude' and let
// PATH resolution have a shot (e.g. in dev, where the interactive shell's PATH is inherited).
import { resolveClaudeBin } from "@/lib/claude-bin";
export { resolveClaudeBin };

function isAlive(pid: number | null | undefined): boolean {
  if (pid == null || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but isn't ours to signal — still alive. ESRCH (or anything
    // else) means it's gone.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function buildPrompt(kind: ExecutorKind, options: StartOptions): string {
  switch (kind) {
    case "apply":
      return buildApplyPrompt({ limit: options.limit, plan: options.plan });
    case "network_send":
      return buildNetworkSendPrompt();
    case "network_find":
      return buildNetworkFindPrompt({ companies: options.companies });
    default:
      throw new Error(`startExecutor: unknown kind '${kind satisfies never}'`);
  }
}

// Any 'running' row whose pid is no longer alive (server restarted mid-run, `claude` was killed
// out of band, etc.) is reclassified as 'failed' so it stops looking like a run that's still
// going. Called both from executorStatus() (so the UI self-heals on the next poll) and from
// startExecutor()'s duplicate-kind check (so a genuinely dead prior run never blocks a new one).
export function reapStaleRuns(db: DB): void {
  const rows = db.prepare("SELECT id, pid FROM executor_runs WHERE status='running'").all() as {
    id: number;
    pid: number | null;
  }[];
  for (const row of rows) {
    if (!isAlive(row.pid)) {
      db.prepare(
        "UPDATE executor_runs SET status='failed', summary=?, ended_at=datetime('now') WHERE id=?"
      ).run("process gone", row.id);
    }
  }
}

export interface StartResult {
  id: number;
  pid: number;
  logPath: string;
}

// Refuses to start a second run of the same `kind` while one is genuinely still running (checked
// by PID liveness, not just the DB's 'running' status — a crashed process leaves a stale
// 'running' row behind). A stale duplicate is reclaimed (marked 'failed') rather than blocking
// the new start.
export function startExecutor(
  db: DB,
  kind: ExecutorKind,
  options: StartOptions = {},
  deps: RunnerDeps = {}
): StartResult {
  const existing = db
    .prepare("SELECT id, pid FROM executor_runs WHERE kind=? AND status='running'")
    .all(kind) as { id: number; pid: number | null }[];
  for (const row of existing) {
    if (isAlive(row.pid)) {
      throw new Error(`startExecutor: a '${kind}' run is already in progress (run #${row.id})`);
    }
    db.prepare(
      "UPDATE executor_runs SET status='failed', summary=?, ended_at=datetime('now') WHERE id=?"
    ).run("process gone", row.id);
  }

  const prompt = buildPrompt(kind, options);
  const logDir = deps.logDir ?? path.join(process.cwd(), "data/executor-logs");
  fs.mkdirSync(logDir, { recursive: true });

  const insert = db
    .prepare("INSERT INTO executor_runs (kind, status, options) VALUES (?, 'running', ?)")
    .run(kind, JSON.stringify(options));
  const runId = Number(insert.lastInsertRowid);

  const logPath = path.join(logDir, `run-${runId}.log`);
  // Ensure the file exists up front (and is truncated) even before the child process — or the
  // fake spawn in tests — has a chance to write to it, so callers can rely on it existing the
  // moment startExecutor returns.
  const logFd = fs.openSync(logPath, "a");

  const spawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const bin = resolveClaudeBin();
  const args = [
    "-p",
    "--output-format",
    "text",
    "--no-session-persistence",
    "--model",
    "claude-sonnet-5",
    "--allowedTools",
    ALLOWED_TOOLS,
  ];

  const child = spawnFn(bin, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["pipe", logFd, logFd],
  });

  child.stdin?.write(prompt);
  child.stdin?.end();

  const pid = child.pid ?? -1;
  db.prepare("UPDATE executor_runs SET pid=?, log_path=? WHERE id=?").run(pid, logPath, runId);

  // detached + unref() lets the App's own process exit/restart independently of the child, but
  // the 'exit' listener below still fires as long as *this* process is alive to hear it — which
  // is the normal case (a long-running launchd-managed Next.js server).
  child.on("exit", (code) => {
    const status = code === 0 ? "done" : "failed";
    db.prepare(
      "UPDATE executor_runs SET status=?, ended_at=datetime('now') WHERE id=? AND status='running'"
    ).run(status, runId);
    try {
      fs.closeSync(logFd);
    } catch {
      // already closed / never opened in some fake-spawn test scenarios — fine either way
    }
  });

  child.unref();

  return { id: runId, pid, logPath };
}

// Sends SIGTERM to the run's process group (negative pid) so a detached `claude` and any
// sub-processes it spawned all get the signal, not just the immediate child. Falls back to
// signalling the bare pid if the group kill errors (e.g. the fake spawn in tests uses a pid that
// isn't really a process group leader). Marks the row 'stopped' regardless — the point is to
// record the user's intent to stop, not to guarantee the OS-level kill succeeded.
export function stopExecutor(db: DB, runId: number): void {
  const row = db.prepare("SELECT pid, status FROM executor_runs WHERE id=?").get(runId) as
    | { pid: number | null; status: string }
    | undefined;
  if (!row) throw new Error(`stopExecutor: no run #${runId}`);
  if (row.status !== "running") {
    throw new Error(`stopExecutor: run #${runId} is not running (status='${row.status}')`);
  }

  if (row.pid != null && row.pid > 0) {
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

  db.prepare("UPDATE executor_runs SET status='stopped', ended_at=datetime('now') WHERE id=?").run(runId);
}

export interface RunStatusRow {
  id: number;
  kind: string;
  status: string;
  pid: number | null;
  logPath: string | null;
  options: unknown;
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
  logTail?: string[];
}

function tailLines(filePath: string, n: number): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-n);
  } catch {
    return [];
  }
}

// The App's polling endpoint: last 10 runs (most recent first), with a ~30-line log tail
// attached for any that are still 'running' so the UI can show live progress. Reaps stale runs
// first so a dead-but-still-marked-'running' row self-heals to 'failed' on the very poll that
// would otherwise keep showing it as active forever.
export function executorStatus(db: DB): RunStatusRow[] {
  reapStaleRuns(db);
  const rows = db
    .prepare(
      "SELECT id, kind, status, pid, log_path, options, summary, started_at, ended_at FROM executor_runs ORDER BY id DESC LIMIT 10"
    )
    .all() as {
    id: number;
    kind: string;
    status: string;
    pid: number | null;
    log_path: string | null;
    options: string;
    summary: string | null;
    started_at: string;
    ended_at: string | null;
  }[];

  return rows.map((r) => {
    let options: unknown = {};
    try {
      options = JSON.parse(r.options);
    } catch {
      options = {};
    }
    const result: RunStatusRow = {
      id: r.id,
      kind: r.kind,
      status: r.status,
      pid: r.pid,
      logPath: r.log_path,
      options,
      summary: r.summary,
      startedAt: r.started_at,
      endedAt: r.ended_at,
    };
    if (r.status === "running" && r.log_path) {
      result.logTail = tailLines(r.log_path, 30);
    }
    return result;
  });
}
