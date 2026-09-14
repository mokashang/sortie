import { spawn as nodeSpawn } from "child_process";
import fs from "fs";
import path from "path";
import { DB } from "@/lib/db";
import { settleRunOutcome } from "@/apply/run-outcome";
import type { RunOutcome, ChainInfo } from "@/app/lib/run-outcome";
import {
  buildApplyPrompt,
  buildNetworkSendPrompt,
  buildNetworkFindPrompt,
  buildJdReviewPrompt,
  ApplyPlanEntry,
} from "@/executor/prompts";
import { createRunToken, revokeRunTokens, pruneExpiredTokens } from "@/lib/api-tokens";
import { ownerId } from "@/lib/users";

// The process manager for headless `claude -p` executor sessions launched from the App's UI.
// See docs on the API routes (src/app/api/executor/*) and README's 投递执行/人脉 sections for the
// end-to-end picture: the user clicks a button in the App, this module spawns a detached
// `claude -p` process wired to prompts.ts's prompt for the requested kind, and the App polls
// executorStatus() to show progress until the process exits.
//
// Every run belongs to one account (executor_runs.user_id, spec 2026-09-13 accounts §3): the
// listing/claim/log/finish/stop functions take the acting user and never touch another
// account's rows. A headless run's prompt carries a run token so its curl calls act as that
// account (src/lib/api-tokens.ts).

// scan = Chrome 扫描 run(值守会话在用户 Chrome 里找岗:LinkedIn 登录态 / Handshake / Tesla,只读,经 /api/scan/ingest 入库)。仅 user_chrome。
export type ExecutorKind = "apply" | "network_send" | "network_find" | "jd_review" | "scan" | "referral_check";

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
  // apply kind only — a run scoped to specific jobs (the 内推进行中 board's 直接投 / 有内推 /
  // 换人再问 buttons enqueue these). `mode` says whether to fill them (direct) or seek a
  // referral for them (referral). Referral mode is attended-session only.
  jobIds?: number[];
  mode?: "referral" | "direct";
  // apply kind only — 接力 (src/apply/continue.ts): chunk = 本段最多做几份(海投填好待确认 + 内推进入
  // 寻找,合计),做满就正常 finish,App 再排下一段;chain = 这段属于哪条接力链(root / 第几段 / 累计)。
  chunk?: number;
  chain?: ChainInfo;
  // scan kind only — 要扫哪些站、时间窗、每站最多抄多少个新岗(默认 全部 / 24h / 40)。
  sites?: ("linkedin" | "handshake" | "tesla")[];
  window?: "24h" | "7d";
  maxPerSite?: number;
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
  opts: { cwd: string; detached: boolean; stdio: [string, number, number]; windowsHide: boolean }
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
import { browserProfileDir, playwrightMcpConfig } from "@/executor/mcp-config";
import { killTree } from "@/lib/proc-kill";
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

function buildPrompt(kind: ExecutorKind, options: StartOptions, token: string): string {
  switch (kind) {
    case "apply":
      return buildApplyPrompt({ limit: options.limit, plan: options.plan, resume: options.resume, token, chunk: options.chunk, chain: options.chain });
    case "network_send":
      return buildNetworkSendPrompt({ token });
    case "network_find":
      return buildNetworkFindPrompt({ companies: options.companies, token });
    case "jd_review":
      return buildJdReviewPrompt({ limit: options.limit, token });
    case "scan":
      throw new Error("scan runs are attended-only (user_chrome); no headless prompt exists");
    case "referral_check":
      throw new Error("referral_check runs are attended-only (user_chrome); no headless prompt exists");
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
// Headless rows whose process is still alive but whose log has not moved for this long are hung
// (a Playwright page that never settles, a `claude -p` waiting on something that will never
// come). Every headless protocol writes a log line at least every few minutes (per page for
// jd_review, per step plus a <=5 min heartbeat while waiting for the user for apply/network), so
// 30 quiet minutes is never a healthy run. Such a run holds a claude process and a whole Chrome
// (~0.8 GB) and blocks every later run of its kind, so it is killed, not just marked.
export const STALE_HEADLESS_MS = 30 * 60 * 1000;

export interface ReapDeps {
  now?: () => number;
  mtime?: (filePath: string) => number | null;
  killTree?: (pid: number) => void;
}

// Machine-wide (every account's runs): a dead process is dead whoever owns it.
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
  const fail = (id: number, summary: string) => {
    db.prepare("UPDATE executor_runs SET status='failed', summary=?, ended_at=datetime('now') WHERE id=?").run(summary, id);
    revokeRunTokens(db, id);
    settleRunOutcome(db, id);
  };
  for (const row of rows) {
    if (row.channel === "user_chrome") {
      const mt = row.log_path ? mtime(row.log_path) : null;
      if (mt != null && now() - mt > STALE_USER_CHROME_MS) fail(row.id, "session gone");
      continue;
    }
    if (!isAlive(row.pid)) {
      fail(row.id, "process gone");
      continue;
    }
    const mt = row.log_path ? mtime(row.log_path) : null;
    if (mt != null && now() - mt > STALE_HEADLESS_MS) {
      const quietMin = Math.round((now() - mt) / 60_000);
      (deps.killTree ?? killTree)(row.pid as number);
      fail(row.id, `hung: no log activity for ${quietMin} min, process tree killed`);
    }
  }
  pruneExpiredTokens(db, new Date(now()));
}

// True if there is currently a 'running' executor_runs row of the given kind for this account
// whose pid is genuinely alive (same liveness check as reapStaleRuns/startExecutor's
// duplicate-kind guard, factored out for callers that only need a yes/no answer — e.g. the
// /api/apply/decide route's auto-start-on-approve check: does NOT reap stale rows itself, since
// a caller that only wants the liveness answer shouldn't have the side effect of mutating run
// rows as a side channel).
//
// user_chrome rows never count here (they have no pid) — see hasLiveOrQueuedRun for the check
// that also covers queued/attended runs.
export function hasLiveRun(db: DB, userId: string, kind: ExecutorKind): boolean {
  const rows = db.prepare("SELECT pid FROM executor_runs WHERE user_id=? AND kind=? AND status='running'").all(userId, kind) as {
    pid: number | null;
  }[];
  return rows.some((row) => isAlive(row.pid));
}

// Like hasLiveRun, but also true for a 'queued' row of the kind (a user_chrome run waiting for an
// attended session to claim it — no pid to check liveness on, but it's still "spoken for" and a
// second auto-start would be a duplicate). Used by decideAndMaybeAutoStart's auto-start-on-approve
// check instead of hasLiveRun, since a queued attended run must also block a second auto-start.
//
// A *running* user_chrome row also counts: it has no pid (the attended session is what's alive),
// and while it's marked running that session is the one polling /api/apply/pending for the
// approval — auto-starting a second run alongside it just produces a duplicate 'resume' row (as
// happened with run #8 on 2026-09-03). Only reapStaleRuns's log-mtime check may retire it.
export function hasLiveOrQueuedRun(db: DB, userId: string, kind: ExecutorKind): boolean {
  const rows = db
    .prepare("SELECT pid, status, channel FROM executor_runs WHERE user_id=? AND kind=? AND status IN ('running','queued')")
    .all(userId, kind) as { pid: number | null; status: string; channel: string }[];
  return rows.some((row) => row.status === "queued" || row.channel === "user_chrome" || isAlive(row.pid));
}

// The channel of the account's most recent run of `kind` (any status), or null if there has
// never been one. Used by decideAndMaybeAutoStart to decide which channel to auto-start on
// approve: it follows whatever channel the user last used for that kind, defaulting to
// user_chrome (the app's default channel) when there's no prior run to follow.
export function lastRunChannel(db: DB, userId: string, kind: ExecutorKind): ExecutorChannel | null {
  const row = db.prepare("SELECT channel FROM executor_runs WHERE user_id=? AND kind=? ORDER BY id DESC LIMIT 1").get(userId, kind) as
    | { channel: string }
    | undefined;
  return (row?.channel as ExecutorChannel | undefined) ?? null;
}

export interface StartResult {
  id: number;
  pid: number | null;
  logPath: string;
}

// Refuses to start a second run of the same `kind`+`channel` for the same account while one is
// genuinely still running (checked by PID liveness for headless, by presence for user_chrome) or
// already queued. A stale headless duplicate (dead pid) is reclaimed (marked 'failed') rather than
// blocking the new start; a queued/running user_chrome duplicate is never "stale" in that sense —
// it's still waiting for an attended session, so it always blocks.
//
// channel='user_chrome' takes the "值守会话" path: no process is spawned. A 'queued' row is
// inserted (pid NULL) with an empty log file ready for the attended session to append to via
// claimNextRun/appendRunLog once it claims the run.
export function startExecutor(
  db: DB,
  userId: string,
  kind: ExecutorKind,
  options: StartOptions = {},
  deps: RunnerDeps = {},
  channel: ExecutorChannel = "headless"
): StartResult {
  const wantsReferral = options.mode === "referral" || (options.plan ?? []).some((p) => p.mode === "referral");
  if (channel === "headless" && wantsReferral) {
    throw new ExecutorStartError("referral_needs_attended", "referral mode needs the attended session (user_chrome): the headless channel only applies directly");
  }
  if (channel === "headless" && kind === "scan") {
    throw new ExecutorStartError("scan_needs_attended", "scan runs need the attended session (user_chrome): LinkedIn/Handshake/Tesla need the user's logged-in Chrome");
  }
  const existing = db
    .prepare("SELECT id, pid, status FROM executor_runs WHERE user_id=? AND kind=? AND channel=? AND status IN ('running','queued')")
    .all(userId, kind, channel) as { id: number; pid: number | null; status: string }[];
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
    revokeRunTokens(db, row.id);
    settleRunOutcome(db, row.id);
  }

  const logDir = deps.logDir ?? path.join(process.cwd(), "data/executor-logs");
  fs.mkdirSync(logDir, { recursive: true });

  if (channel === "user_chrome") {
    const insert = db
      .prepare("INSERT INTO executor_runs (user_id, kind, status, channel, pid, options) VALUES (?, ?, 'queued', 'user_chrome', NULL, ?)")
      .run(userId, kind, JSON.stringify(options));
    const runId = Number(insert.lastInsertRowid);
    const logPath = path.join(logDir, `run-${runId}.log`);
    fs.closeSync(fs.openSync(logPath, "a"));
    db.prepare("UPDATE executor_runs SET log_path=? WHERE id=?").run(logPath, runId);
    return { id: runId, pid: null, logPath };
  }

  const insert = db
    .prepare("INSERT INTO executor_runs (user_id, kind, status, channel, options) VALUES (?, ?, 'running', 'headless', ?)")
    .run(userId, kind, JSON.stringify(options));
  const runId = Number(insert.lastInsertRowid);

  // The run token is what makes this session act as `userId` on every API call (see prompts.ts's
  // curlCmd). Minted before the prompt so it can be baked into the text; revoked at finish/reap.
  const token = createRunToken(db, userId, runId);
  const prompt = buildPrompt(kind, options, token);

  const logPath = path.join(logDir, `run-${runId}.log`);
  // Ensure the file exists up front (and is truncated) even before the child process — or the
  // fake spawn in tests — has a chance to write to it, so callers can rely on it existing the
  // moment startExecutor returns.
  const logFd = fs.openSync(logPath, "a");

  const spawnFn = deps.spawn ?? (nodeSpawn as unknown as SpawnFn);
  const bin = resolveClaudeBin();
  // The owner keeps the pre-accounts data/browser-profile; every other account gets its own.
  const profileDir = browserProfileDir(process.cwd(), ownerId(db) === userId ? null : userId);
  const args = [
    "-p",
    "--output-format",
    "text",
    "--no-session-persistence",
    "--model",
    "claude-sonnet-5",
    "--allowedTools",
    ALLOWED_TOOLS,
    // Exactly one MCP server (playwright on the account's browser profile), registered inline;
    // every other MCP config on the machine is ignored — see src/executor/mcp-config.ts.
    "--mcp-config",
    playwrightMcpConfig(profileDir),
    "--strict-mcp-config",
  ];

  // windowsHide: the server itself has no console (pm2 starts it hidden), so without this flag
  // Windows would open a new, blank console window for every detached `claude -p` child — which
  // the user saw as stray "claude" command windows popping up (2026-09-11). No-op elsewhere.
  const child = spawnFn(bin, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: ["pipe", logFd, logFd],
    windowsHide: true,
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
    const ended = db.prepare(
      "UPDATE executor_runs SET status=?, ended_at=datetime('now') WHERE id=? AND status='running'"
    ).run(status, runId);
    revokeRunTokens(db, runId);
    // 0 changes = the session already reported finish through the App; its outcome is settled.
    if (ended.changes > 0) {
      settleRunOutcome(db, runId);
      // 接力: a headless segment that ended normally may need the next one queued (the attended
      // path does this in the finish route). Dynamic import because continue.ts imports this
      // module; db.open guards the fake-spawn tests that close the db before the import lands.
      if (status === "done") {
        void import("@/apply/continue")
          .then((m) => {
            if (db.open) m.maybeContinueApplyRun(db, runId);
          })
          .catch((e) => console.error("[apply continue] headless exit", e));
      }
    }
    try {
      fs.closeSync(logFd);
    } catch {
      // already closed / never opened in some fake-spawn test scenarios — fine either way
    }
  });

  child.unref();

  return { id: runId, pid, logPath };
}

// Kills the run's whole process tree via killTree() (process-group SIGTERM on POSIX, taskkill on
// Windows) so a detached `claude` and any sub-processes it spawned all go, not just the immediate
// child. Marks the row 'stopped' regardless — the point is to record the user's intent to stop,
// not to guarantee the OS-level kill succeeded.
export function stopExecutor(db: DB, userId: string, runId: number): void {
  const row = db.prepare("SELECT pid, status, channel FROM executor_runs WHERE user_id=? AND id=?").get(userId, runId) as
    | { pid: number | null; status: string; channel: string }
    | undefined;
  if (!row) throw new Error(`stopExecutor: no run #${runId}`);
  // 'paused' = a 接力 segment parked behind the confirmation backlog (src/apply/continue.ts):
  // stopping it is how the user ends the chain; there is no process to signal.
  if (row.status !== "running" && row.status !== "queued" && row.status !== "paused") {
    throw new Error(`stopExecutor: run #${runId} is not running (status='${row.status}')`);
  }

  // user_chrome rows have no OS process of ours to signal (a queued one has nothing running yet;
  // a claimed one is being driven by an attended Claude Code session, not a child of this
  // process) — the attended session's own poll loop notices the 'stopped' status via
  // GET /api/executor/run and stops itself. For headless rows, SIGTERM the process group as
  // before.
  if (row.channel !== "user_chrome" && row.pid != null && row.pid > 0) {
    killTree(row.pid);
  }

  db.prepare("UPDATE executor_runs SET status='stopped', ended_at=datetime('now') WHERE id=?").run(runId);
  revokeRunTokens(db, runId);
  settleRunOutcome(db, runId);
}

export interface ClaimedRun {
  id: number;
  kind: ExecutorKind;
  options: unknown;
  logPath: string | null;
}

// The attended session's poll loop calls this (GET /api/executor/claim-next?channel=user_chrome)
// to pick up the account's oldest queued run of that channel: atomically flips it queued ->
// running (the `AND status='queued'` guard means a race between two attended sessions polling at
// once loses gracefully — the loser's UPDATE affects 0 rows and it gets null back, not someone
// else's run). Returns null when there's nothing queued.
// `kinds` (optional) restricts which run kinds this claimer takes — an attended session that only
// knows the apply/referral protocols must not swallow a queued 'scan' run meant for another.
export function claimNextRun(db: DB, userId: string, channel: ExecutorChannel = "user_chrome", kinds?: ExecutorKind[]): ClaimedRun | null {
  const kindFilter = kinds && kinds.length > 0 ? ` AND kind IN (${kinds.map(() => "?").join(",")})` : "";
  const row = db
    .prepare(`SELECT id, kind, options, log_path FROM executor_runs WHERE user_id=? AND channel=? AND status='queued'${kindFilter} ORDER BY id ASC LIMIT 1`)
    .get(userId, channel, ...(kinds ?? [])) as { id: number; kind: string; options: string; log_path: string | null } | undefined;
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

// The oldest queued user_chrome run for an account, without claiming it (the dispatcher's view).
export function nextQueuedRun(db: DB, userId: string): { id: number; kind: ExecutorKind } | null {
  const row = db
    .prepare("SELECT id, kind FROM executor_runs WHERE user_id=? AND channel='user_chrome' AND status='queued' ORDER BY id ASC LIMIT 1")
    .get(userId) as { id: number; kind: string } | undefined;
  return row ? { id: row.id, kind: row.kind as ExecutorKind } : null;
}

function ownedRun<T>(db: DB, userId: string, runId: number, cols: string, what: string): T {
  const row = db.prepare(`SELECT ${cols} FROM executor_runs WHERE user_id=? AND id=?`).get(userId, runId) as T | undefined;
  if (!row) throw new Error(`${what}: no run #${runId}`);
  return row;
}

// Appends one timestamped line to a run's log file — how an attended session reports progress
// back (POST /api/executor/log), mirroring what tailLines()/the App's status poll read from a
// headless run's stdout-redirected log. Throws for an unknown run or one with no log_path yet
// (should never happen: startExecutor always creates the file before returning) rather than
// silently dropping the line.
export function appendRunLog(db: DB, userId: string, runId: number, line: string): void {
  const row = ownedRun<{ log_path: string | null }>(db, userId, runId, "log_path", "appendRunLog");
  if (!row.log_path) throw new Error(`appendRunLog: run #${runId} has no log_path`);
  const ts = new Date().toTimeString().slice(0, 8); // HH:MM:SS
  fs.appendFileSync(row.log_path, `[${ts}] ${line}\n`);
}

// The attended session calls this (POST /api/executor/finish) when it's done driving the browser
// for a run — success, failure, or the user stopped it mid-way. Only valid from 'running' or
// 'queued' (a session might finish immediately without ever logging progress); anything else
// (already done/failed/stopped) is a no-op-that-throws so a duplicate finish call surfaces rather
// than silently overwriting a terminal status.
export function finishRun(db: DB, userId: string, runId: number, status: "done" | "failed" | "stopped", summary?: string): void {
  const row = ownedRun<{ status: string }>(db, userId, runId, "status", "finishRun");
  if (row.status !== "running" && row.status !== "queued") {
    throw new Error(`finishRun: run #${runId} is not running/queued (status='${row.status}')`);
  }
  db.prepare("UPDATE executor_runs SET status=?, summary=?, ended_at=datetime('now') WHERE id=?").run(
    status,
    summary ?? null,
    runId
  );
  revokeRunTokens(db, runId);
  settleRunOutcome(db, runId);
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
  // Planned-vs-achieved snapshot for apply runs with a plan, written when the run reaches a
  // terminal status (null otherwise, and while the run is live) — src/apply/run-outcome.ts.
  outcome: RunOutcome | null;
  startedAt: string;
  claimedAt: string | null;
  endedAt: string | null;
  logTail?: string[];
}

interface RawRunRow {
  id: number;
  kind: string;
  status: string;
  channel: string;
  pid: number | null;
  log_path: string | null;
  options: string;
  summary: string | null;
  outcome: string | null;
  started_at: string;
  claimed_at: string | null;
  ended_at: string | null;
}

const RUN_COLS = "id, kind, status, channel, pid, log_path, options, summary, outcome, started_at, claimed_at, ended_at";

function parseOutcome(raw: string | null): RunOutcome | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RunOutcome;
  } catch {
    return null;
  }
}

function toStatusRow(r: RawRunRow): RunStatusRow {
  let options: unknown = {};
  try {
    options = JSON.parse(r.options);
  } catch {
    options = {};
  }
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    channel: r.channel,
    pid: r.pid,
    logPath: r.log_path,
    options,
    summary: r.summary,
    outcome: parseOutcome(r.outcome),
    startedAt: r.started_at,
    claimedAt: r.claimed_at,
    endedAt: r.ended_at,
  };
}

// One run row (GET /api/executor/run?id=), or null when it is not this account's.
export function getRun(db: DB, userId: string, runId: number): RunStatusRow | null {
  const row = db.prepare(`SELECT ${RUN_COLS} FROM executor_runs WHERE user_id=? AND id=?`).get(userId, runId) as RawRunRow | undefined;
  return row ? toStatusRow(row) : null;
}

// The App's "详情" view of one run (GET /api/executor/log?id=): the whole log, not a tail, for
// running and finished runs alike — an attended session logs every step it takes (claim, open
// page, eligibility check, each field group, upload, read-back, report, wait, submit), and the
// user wants to be able to read all of it after the fact. Throws for an unknown run; a missing
// log file (deleted out of band) reads as empty rather than an error.
export function runLogLines(db: DB, userId: string, runId: number): string[] {
  const row = ownedRun<{ log_path: string | null }>(db, userId, runId, "log_path", "runLogLines");
  if (!row.log_path) return [];
  return tailLines(row.log_path, Number.MAX_SAFE_INTEGER);
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

// The App's polling endpoint: the account's last 10 runs (most recent first), with a ~30-line log
// tail attached for any that are still 'running' so the UI can show live progress. Reaps stale
// runs first so a dead-but-still-marked-'running' row self-heals to 'failed' on the very poll that
// would otherwise keep showing it as active forever.
export function executorStatus(db: DB, userId: string): RunStatusRow[] {
  reapStaleRuns(db);
  const rows = db
    .prepare(`SELECT ${RUN_COLS} FROM executor_runs WHERE user_id=? ORDER BY id DESC LIMIT 10`)
    .all(userId) as RawRunRow[];

  return rows.map((r) => {
    const result = toStatusRow(r);
    if ((r.status === "running" || r.status === "queued") && r.log_path) {
      result.logTail = tailLines(r.log_path, 30);
    }
    return result;
  });
}

// A start refused because the channel cannot do what was asked (referrals or scanning on the
// headless channel). The code lets the API route pick a message in the UI language
// (src/i18n/messages/errors.ts); the English text is for logs and tests.
export type ExecutorStartErrorCode = "referral_needs_attended" | "scan_needs_attended";
export class ExecutorStartError extends Error {
  code: ExecutorStartErrorCode;
  constructor(code: ExecutorStartErrorCode, message: string) {
    super(message);
    this.name = "ExecutorStartError";
    this.code = code;
  }
}
