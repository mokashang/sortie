import { DB } from "@/lib/db";
import { PARALLEL_CHOICES, DEFAULT_PARALLEL, isParallelChoice } from "@/app/lib/parallel";

// Which dispatcher-spawned attended session owns what (2026-09-30, parallel apply tasks — spec
// docs/superpowers/specs/2026-09-30-parallel-apply-design.md). Until then there was one spawned
// session at a time, so "the session" needed no name: every approval, answer, stop and reminder
// was typed into the one terminal. Now the dispatcher keeps up to N sessions, each working its
// own task in its own tab group of the same Chrome, and each line has to reach the session whose
// tab it is about — a session only sees its own tab group, so the wrong one cannot act on it.
//
// The records live in the `profile` key/value table (no schema change):
//   attended_spawns = SpawnRecord[]        (attended_spawn = the single pre-2026-09-30 record)
// A run belongs to the session that claimed it: claim-next stamps the claimer's pid on the run
// (executor_runs.pid — the process working on the run, exactly what it means for a headless run;
// user_chrome rows used to leave it NULL). A session is recognized by its run token, minted for
// the run it was spawned for (SpawnRecord.runId). An application belongs to the session that owns
// the run that took it (applications.run_id).

export const SPAWNS_KEY = "attended_spawns";
export const LEGACY_SPAWN_KEY = "attended_spawn";

// 设置 → 同时进行的任务: how many sessions the dispatcher may keep at once (the box owner's choice;
// the dispatcher only serves the owner). 1 is the old behavior — one task at a time, the rest
// queued behind it.
export const PARALLEL_KEY = "attended_parallel";

export function attendedParallel(db: DB): number {
  const row = db.prepare("SELECT value FROM profile WHERE key = ?").get(PARALLEL_KEY) as { value: string } | undefined;
  const n = Number(row?.value);
  return isParallelChoice(n) ? n : DEFAULT_PARALLEL;
}

export function setAttendedParallel(db: DB, n: number): void {
  if (!isParallelChoice(n)) throw new Error(`parallel must be one of ${PARALLEL_CHOICES.join(", ")}`);
  db.prepare("INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(PARALLEL_KEY, String(n));
}

export interface SpawnRecord {
  pid: number;
  // The run the session was spawned for; its run token is minted for this run.
  runId: number;
  startedAt: string; // ISO
  logPath: string;
  // ISO time the session was first seen idle (cleared while it has work); drives IDLE_REAP_MS.
  idleSince?: string | null;
}

function readJson<T>(db: DB, key: string): T | null {
  const row = db.prepare("SELECT value FROM profile WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

function isRecord(r: unknown): r is SpawnRecord {
  return !!r && typeof r === "object" && typeof (r as SpawnRecord).pid === "number" && typeof (r as SpawnRecord).runId === "number";
}

// Oldest first. A box upgraded from the single-session dispatcher still has its one record under
// the old key; it reads as a list of one until the next write moves it.
export function listSpawns(db: DB): SpawnRecord[] {
  const list = readJson<unknown[]>(db, SPAWNS_KEY);
  if (Array.isArray(list)) return list.filter(isRecord);
  const legacy = readJson<unknown>(db, LEGACY_SPAWN_KEY);
  return isRecord(legacy) ? [legacy] : [];
}

export function saveSpawns(db: DB, list: SpawnRecord[]): void {
  db.prepare("DELETE FROM profile WHERE key = ?").run(LEGACY_SPAWN_KEY);
  if (list.length === 0) db.prepare("DELETE FROM profile WHERE key = ?").run(SPAWNS_KEY);
  else
    db.prepare("INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
      SPAWNS_KEY,
      JSON.stringify(list)
    );
}

// ISO → SQLite datetime('now') form (UTC, whole seconds, floored) so it compares as text against
// executor_runs.claimed_at. Flooring also absorbs the ~1 ms by which SQLite's clock can trail.
export function sqliteTime(iso: string): string {
  const t = Date.parse(iso);
  return (Number.isNaN(t) ? new Date(0) : new Date(t)).toISOString().slice(0, 19).replace("T", " ");
}

export interface RunOwnerFields {
  pid: number | null;
  claimed_at: string | null;
  channel: string | null;
}

// The session that claimed a run, among `spawns`; null when none of them did (an earlier session,
// a desktop session, a headless run). A run claimed without a claimer — by a desktop session, a
// test, or before 2026-09-30 — falls to the session that was newest when it was claimed: the
// single-session rule this replaces. The claimed_at bound keeps a recycled pid from adopting runs
// an earlier process claimed.
export function ownerOf(run: RunOwnerFields, spawns: SpawnRecord[]): SpawnRecord | null {
  if (run.channel !== "user_chrome" || !run.claimed_at) return null;
  const claimed = run.claimed_at;
  if (run.pid != null) return spawns.find((s) => s.pid === run.pid && claimed >= sqliteTime(s.startedAt)) ?? null;
  let best: SpawnRecord | null = null;
  for (const s of spawns) {
    const t = sqliteTime(s.startedAt);
    if (claimed >= t && (!best || t > sqliteTime(best.startedAt))) best = s;
  }
  return best;
}

export function sameSession(a: SpawnRecord | null, b: SpawnRecord | null): boolean {
  return !!a && !!b && a.pid === b.pid && a.startedAt === b.startedAt;
}

export function sessionOfRun(db: DB, runId: number, spawns: SpawnRecord[] = listSpawns(db)): SpawnRecord | null {
  const run = db.prepare("SELECT pid, claimed_at, channel FROM executor_runs WHERE id = ?").get(runId) as RunOwnerFields | undefined;
  return run ? ownerOf(run, spawns) : null;
}

// The session holding the tab for this job's application: the owner of the run that took it.
export function sessionOfJob(db: DB, userId: string, jobId: number, spawns: SpawnRecord[] = listSpawns(db)): SpawnRecord | null {
  const run = db
    .prepare("SELECT r.pid, r.claimed_at, r.channel FROM applications a JOIN executor_runs r ON r.id = a.run_id WHERE a.user_id = ? AND a.job_id = ?")
    .get(userId, jobId) as RunOwnerFields | undefined;
  return run ? ownerOf(run, spawns) : null;
}

// Who is calling, as far as sessions go: a spawned session presents the run token minted for the
// run it was spawned for. Anything else (a desktop session on the internal token, the browser, a
// headless run) is not a spawned session.
export interface Caller {
  via: string;
  runId: number | null;
}
export function sessionOfCaller(db: DB, caller: Caller, spawns: SpawnRecord[] = listSpawns(db)): SpawnRecord | null {
  if (caller.via !== "run" || caller.runId == null) return null;
  return spawns.find((s) => s.runId === caller.runId) ?? null;
}

interface OwnedRunRow extends RunOwnerFields {
  id: number;
  kind: string;
  status: string;
  log_path: string | null;
}

// Runs the session claimed, newest first.
export function runsOfSession(db: DB, userId: string, session: SpawnRecord, spawns: SpawnRecord[] = listSpawns(db)): OwnedRunRow[] {
  const rows = db
    .prepare(
      "SELECT id, kind, status, pid, claimed_at, channel, log_path FROM executor_runs WHERE user_id = ? AND channel = 'user_chrome' AND claimed_at >= ? ORDER BY id DESC"
    )
    .all(userId, sqliteTime(session.startedAt)) as OwnedRunRow[];
  return rows.filter((r) => sameSession(ownerOf(r, spawns), session));
}

// The apply run that a job taken by this caller belongs to (applications.run_id), so two tasks
// running side by side each count their own fills. A spawned session: the apply run it is working
// on, else the last one it worked (a tab it re-opens after its run ended stays its own). A headless
// run: its own run. undefined: not a session — the caller falls back to the account's newest
// running apply run, the rule from before parallel tasks (a desktop session works one at a time).
export function callerApplyRunId(db: DB, userId: string, caller: Caller): number | null | undefined {
  if (caller.via !== "run" || caller.runId == null) return undefined;
  const spawns = listSpawns(db);
  const session = sessionOfCaller(db, caller, spawns);
  if (session) {
    const mine = runsOfSession(db, userId, session, spawns).filter((r) => r.kind === "apply");
    return (mine.find((r) => r.status === "running") ?? mine[0])?.id ?? null;
  }
  const own = db.prepare("SELECT id, kind FROM executor_runs WHERE id = ? AND user_id = ?").get(caller.runId, userId) as
    | { id: number; kind: string }
    | undefined;
  return own?.kind === "apply" ? own.id : undefined;
}
