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

// headless: this module spawns a detached `claude -p` process itself (unchanged path).
// user_chrome: the "值守会话" (attended session) channel — no process is spawned here. A row is
// enqueued 'queued' and an already-open *interactive* Claude Code session (with the
// claude-in-chrome extension attached to the user's real, logged-in Chrome) polls
// GET /api/executor/claim-next to pick it up, drives the browser itself, and reports progress via
// POST /api/executor/log + /api/executor/finish. This exists because the Claude-in-Chrome
// extension only attaches to an interactive session — headless `claude -p --chrome` can't use it.
export type ExecutorChannel = "headless" | "user_chrome";

export interface StartOptions {
  limit?: number;
  companies?: string[];
  // apply kind only — per-direction quota plan, processed in order. See buildApplyPrompt.
  plan?: ApplyPlanEntry[];
  // apply kind only — resume mode: the session's first phase re-fills and re-submits any
  // application left sitting at approved+awaiting_confirm by a prior executor process that died
  // before it could submit. See buildApplyPrompt's resume section and the /api/apply/decide
  // route's auto-start-on-approve path, which is what actually sets this.
  resume?: boolean;
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
      return buildApplyPrompt({ limit: options.limit, plan: options.plan, resume: options.resume });
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
//
// user_chrome rows have no pid to check (the attended interactive session, not this process, is
// what's "alive") — instead we treat one as stale (session gone) once its log file hasn't been
// touched in STALE_USER_CHROME_MS. `now`/`mtime` are injectable so tests don't need real
// wall-clock waits or real files.
const STALE_USER_CHROME_MS = 20 * 60 * 1000;

export interface ReapDeps {
  now?: () => number;
  mtime?: (filePath: string) => number | null;
}

export function reapStaleRuns(db: DB, deps: ReapDeps = {}): void {
  const now = deps.now ?? (() => Date.now());
  const mtime =
    deps.mtime ??
    ((filePath: string): number | null => {
      try {
        return fs.statSync(filePath).mtimeMs;
      } catch {
        return null;
      }
    });

  const rows = db.prepare("SELECT id, pid, channel, log_path FROM executor_runs WHERE status='running'").all() as {
    id: number;
    pid: number | null;
    channel: string;
    log_path: string | null;
  }[];
  for (const row of rows) {
    if (row.channel === "user_chrome") {
      const mt = row.log_path ? mtime(row.log_path) : null;
      if (mt != null && now() - mt > STALE_USER_CHROME_MS) {
        db.prepare(
          "UPDATE executor_runs SET status='failed', summary=?, ended_at=datetime('now') WHERE id=?"
        ).run("session gone", row.id);
      }
      continue;
    }
    if (!isAlive(row.pid)) {
      db.prepare(
        "UPDATE executor_runs SET status='failed', summary=?, ended_at=datetime('now') WHERE id=?"
      ).run("process gone", row.id);
    }
  }
}

// True if there is currently a 'running' executor_runs row of the given kind whose pid is
// genuinely alive (same liveness check as reapStaleRuns/startExecutor's duplicate-kind guard,
// factored out for callers that only need a yes/no answer — e.g. the /api/apply/decide route's
// auto-start-on-approve check: does NOT reap stale rows itself, since a caller that only wants
// the liveness answer shouldn't have the side effect of mutating run rows as a side channel).
//
// user_chrome rows never count here (they have no pid) — see hasLiveOrQueuedRun for the check
// that also covers queued/attended runs.
export function hasLiveRun(db: DB, kind: ExecutorKind): boolean {
  const rows = db.prepare("SELECT pid FROM executor_runs WHERE kind=? AND status='running'").all(kind) as {
    pid: number | null;
  }[];
  return rows.some((row) => isAlive(row.pid));
}

// Like hasLiveRun, but also true for a 'queued' row of the kind (a user_chrome run waiting for an
// attended session to claim it — no pid to check liveness on, but it's still "spoken for" and a
// second auto-start would be a duplicate). Used by decideAndMaybeAutoStart's auto-start-on-approve
// check instead of hasLiveRun, since a queued attended run must also block a second auto-start.
export function hasLiveOrQueuedRun(db: DB, kind: ExecutorKind): boolean {
  const rows = db
    .prepare("SELECT pid, status FROM executor_runs WHERE kind=? AND status IN ('running','queued')")
    .all(kind) as { pid: number | null; status: string }[];
  return rows.some((row) => row.status === "queued" || isAlive(row.pid));
}

// The channel of the most recent run of `kind` (any status), or null if there has never been one.
// Used by decideAndMaybeAutoStart to decide which channel to auto-start on approve: it follows
// whatever channel the user last used for that kind, defaulting to user_chrome (the app's default
// channel) when there's no prior run to follow.
export function lastRunChannel(db: DB, kind: ExecutorKind): ExecutorChannel | null {
  const row = db.prepare("SELECT channel FROM executor_runs WHERE kind=? ORDER BY id DESC LIMIT 1").get(kind) as
    | { channel: string }
    | undefined;
  return (row?.channel as ExecutorChannel | undefined) ?? null;
}

export interface StartResult {
  id: number;
  pid: number | null;
  logPath: string;
}

// Refuses to start a second run of the same `kind`+`channel` while one is genuinely still running
// (checked by PID liveness for headless, by presence for user_chrome) or already queued. A stale
// headless duplicate (dead pid) is reclaimed (marked 'failed') rather than blocking the new start;
// a queued/running user_chrome duplicate is never "stale" in that sense — it's still waiting for
// an attended session, so it always blocks.
//
// channel='user_chrome' takes the "值守会话" path: no process is spawned. A 'queued' row is
// inserted (pid NULL) with an empty log file ready for the attended session to append to via
// claimNextRun/appendRunLog once it claims the run.
export function startExecutor(
  db: DB,
  kind: ExecutorKind,
  options: StartOptions = {},
  deps: RunnerDeps = {},
  channel: ExecutorChannel = "headless"
): StartResult {
  const existing = db
    .prepare("SELECT id, pid, status FROM executor_runs WHERE kind=? AND channel=? AND status IN ('running','queued')")
    .all(kind, channel) as { id: number; pid: number | null; status: string }[];
  for (const row of existing) {
    // user_chrome rows have no pid to check liveness on — any 'running' or 'queued' row of the
    // channel always blocks (only reapStaleRuns's mtime-staleness check can clear one out, and
    // that already ran by the time a caller gets here via the App's normal polling loop).
    const blocks = channel === "user_chrome" || row.status === "queued" || isAlive(row.pid);
    if (blocks) {
      throw new Error(`startExecutor: a '${kind}' run is already in progress (run #${row.id})`);
    }
    db.prepare(
      "UPDATE executor_runs SET status='failed', summary=?, ended_at=datetime('now') WHERE id=?"
    ).run("process gone", row.id);
  }

  const logDir = deps.logDir ?? path.join(process.cwd(), "data/executor-logs");
  fs.mkdirSync(logDir, { recursive: true });

  if (channel === "user_chrome") {
    const insert = db
      .prepare("INSERT INTO executor_runs (kind, status, channel, pid, options) VALUES (?, 'queued', 'user_chrome', NULL, ?)")
      .run(kind, JSON.stringify(options));
    const runId = Number(insert.lastInsertRowid);
    const logPath = path.join(logDir, `run-${runId}.log`);
    fs.closeSync(fs.openSync(logPath, "a"));
    db.prepare("UPDATE executor_runs SET log_path=? WHERE id=?").run(logPath, runId);
    return { id: runId, pid: null, logPath };
  }

  const prompt = buildPrompt(kind, options);

  const insert = db
    .prepare("INSERT INTO executor_runs (kind, status, channel, options) VALUES (?, 'running', 'headless', ?)")
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
  const row = db.prepare("SELECT pid, status, channel FROM executor_runs WHERE id=?").get(runId) as
    | { pid: number | null; status: string; channel: string }
    | undefined;
  if (!row) throw new Error(`stopExecutor: no run #${runId}`);
  if (row.status !== "running" && row.status !== "queued") {
    throw new Error(`stopExecutor: run #${runId} is not running (status='${row.status}')`);
  }

  // user_chrome rows have no OS process of ours to signal (a queued one has nothing running yet;
  // a claimed one is being driven by an attended Claude Code session, not a child of this
  // process) — the attended session's own poll loop notices the 'stopped' status via
  // GET /api/executor/run and stops itself. For headless rows, SIGTERM the process group as
  // before.
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

  db.prepare("UPDATE executor_runs SET status='stopped', ended_at=datetime('now') WHERE id=?").run(runId);
}

export interface ClaimedRun {
  id: number;
  kind: ExecutorKind;
  options: unknown;
  logPath: string | null;
}

// The attended session's poll loop calls this (GET /api/executor/claim-next?channel=user_chrome)
// to pick up the oldest queued run of that channel: atomically flips it queued -> running (the
// `AND status='queued'` guard means a race between two attended sessions polling at once loses
// gracefully — the loser's UPDATE affects 0 rows and it gets null back, not someone else's run).
// Returns null when there's nothing queued.
export function claimNextRun(db: DB, channel: ExecutorChannel = "user_chrome"): ClaimedRun | null {
  const row = db
    .prepare("SELECT id, kind, options, log_path FROM executor_runs WHERE channel=? AND status='queued' ORDER BY id ASC LIMIT 1")
    .get(channel) as { id: number; kind: string; options: string; log_path: string | null } | undefined;
  if (!row) return null;

  const result = db
    .prepare("UPDATE executor_runs SET status='running', claimed_at=datetime('now') WHERE id=? AND status='queued'")
    .run(row.id);
  if (result.changes === 0) return null; // lost a race with another claimer

  let options: unknown = {};
  try {
    options = JSON.parse(row.options);
  } catch {
    options = {};
  }
  return { id: row.id, kind: row.kind as ExecutorKind, options, logPath: row.log_path };
}

// Appends one timestamped line to a run's log file — how an attended session reports progress
// back (POST /api/executor/log), mirroring what tailLines()/the App's status poll read from a
// headless run's stdout-redirected log. Throws for an unknown run or one with no log_path yet
// (should never happen: startExecutor always creates the file before returning) rather than
// silently dropping the line.
export function appendRunLog(db: DB, runId: number, line: string): void {
  const row = db.prepare("SELECT log_path FROM executor_runs WHERE id=?").get(runId) as
    | { log_path: string | null }
    | undefined;
  if (!row) throw new Error(`appendRunLog: no run #${runId}`);
  if (!row.log_path) throw new Error(`appendRunLog: run #${runId} has no log_path`);
  const ts = new Date().toTimeString().slice(0, 8); // HH:MM:SS
  fs.appendFileSync(row.log_path, `[${ts}] ${line}\n`);
}

// The attended session calls this (POST /api/executor/finish) when it's done driving the browser
// for a run — success, failure, or the user stopped it mid-way. Only valid from 'running' or
// 'queued' (a session might finish immediately without ever logging progress); anything else
// (already done/failed/stopped) is a no-op-that-throws so a duplicate finish call surfaces rather
// than silently overwriting a terminal status.
export function finishRun(db: DB, runId: number, status: "done" | "failed" | "stopped", summary?: string): void {
  const row = db.prepare("SELECT status FROM executor_runs WHERE id=?").get(runId) as { status: string } | undefined;
  if (!row) throw new Error(`finishRun: no run #${runId}`);
  if (row.status !== "running" && row.status !== "queued") {
    throw new Error(`finishRun: run #${runId} is not running/queued (status='${row.status}')`);
  }
  db.prepare("UPDATE executor_runs SET status=?, summary=?, ended_at=datetime('now') WHERE id=?").run(
    status,
    summary ?? null,
    runId
  );
}

export interface RunStatusRow {
  id: number;
  kind: string;
  status: string;
  channel: string;
  pid: number | null;
  logPath: string | null;
  options: unknown;
  summary: string | null;
  startedAt: string;
  claimedAt: string | null;
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
      "SELECT id, kind, status, channel, pid, log_path, options, summary, started_at, claimed_at, ended_at FROM executor_runs ORDER BY id DESC LIMIT 10"
    )
    .all() as {
    id: number;
    kind: string;
    status: string;
    channel: string;
    pid: number | null;
    log_path: string | null;
    options: string;
    summary: string | null;
    started_at: string;
    claimed_at: string | null;
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
      channel: r.channel,
      pid: r.pid,
      logPath: r.log_path,
      options,
      summary: r.summary,
      startedAt: r.started_at,
      claimedAt: r.claimed_at,
      endedAt: r.ended_at,
    };
    if ((r.status === "running" || r.status === "queued") && r.log_path) {
      result.logTail = tailLines(r.log_path, 30);
    }
    return result;
  });
}
