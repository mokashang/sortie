import { DB } from "@/lib/db";
import { listSpawns, sameSession, type SpawnRecord } from "@/executor/sessions";

// Approved messages handed to one session at a time (2026-09-30, parallel apply tasks). Every
// apply segment starts with a resume phase that sends the approved referral messages
// (GET /api/network/sendables, CLAUDE.md §3.10.f); with two segments starting side by side, both
// would walk the same list in the same order and could send one person the same note twice in
// the seconds before either reports it sent. So a dispatcher-spawned session that asks gets the
// rows nobody else holds, and holds them for OUTREACH_LEASE_MS — a lease lapses with its session
// (gone or unreachable) or with time, so a row is never stuck behind a session that dropped it.
//
// Stored in the `profile` key/value table: outreach_leases = {<outreachId>: {pid, startedAt, at}}.

export const OUTREACH_LEASE_KEY = "outreach_leases";
export const OUTREACH_LEASE_MS = 30 * 60 * 1000;

interface Lease {
  pid: number;
  startedAt: string;
  at: number;
}

function readLeases(db: DB): Record<string, Lease> {
  const row = db.prepare("SELECT value FROM profile WHERE key = ?").get(OUTREACH_LEASE_KEY) as { value: string } | undefined;
  if (!row) return {};
  try {
    const v = JSON.parse(row.value);
    return v && typeof v === "object" ? (v as Record<string, Lease>) : {};
  } catch {
    return {};
  }
}

// The rows of `rows` this session may send now; those are (re)leased to it. Expired leases are
// dropped as they are met.
export function leaseSendables<T extends { id: number }>(
  db: DB,
  rows: T[],
  caller: SpawnRecord,
  holderLive: (s: SpawnRecord) => boolean,
  now = Date.now()
): T[] {
  const spawns = listSpawns(db);
  const leases = readLeases(db);
  const next: Record<string, Lease> = {};
  for (const [id, lease] of Object.entries(leases)) if (now - lease.at < OUTREACH_LEASE_MS) next[id] = lease;
  const mine: T[] = [];
  for (const row of rows) {
    const lease = leases[String(row.id)];
    const holder = lease ? (spawns.find((s) => s.pid === lease.pid && s.startedAt === lease.startedAt) ?? null) : null;
    if (lease && holder && !sameSession(holder, caller) && holderLive(holder) && now - lease.at < OUTREACH_LEASE_MS) {
      next[String(row.id)] = lease;
      continue;
    }
    next[String(row.id)] = { pid: caller.pid, startedAt: caller.startedAt, at: now };
    mine.push(row);
  }
  db.prepare("INSERT INTO profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    OUTREACH_LEASE_KEY,
    JSON.stringify(next)
  );
  return mine;
}
