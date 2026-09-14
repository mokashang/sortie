import { DB } from "@/lib/db";
import { referralChecklist } from "@/network/harvest";
import { startExecutor, StartOptions } from "@/executor/runner";
import { listUsers } from "@/lib/users";

// Enqueue a 'referral_check' attended run (kind handled by CLAUDE.md §3.10 i) for one account
// when there is something to check and no such run is already queued/running for them. Returns
// the run id or null.
export function enqueueReferralCheck(db: DB, userId: string, deps: { startExecutor?: typeof startExecutor } = {}): number | null {
  if (referralChecklist(db, userId).length === 0) return null;
  const live = db
    .prepare("SELECT id FROM executor_runs WHERE user_id = ? AND kind = 'referral_check' AND status IN ('queued','running')")
    .get(userId) as { id: number } | undefined;
  if (live) return null;
  const start = deps.startExecutor ?? startExecutor;
  const options: StartOptions = {};
  return start(db, userId, "referral_check", options, {}, "user_chrome").id;
}

// The twice-daily tick: one run per account that has conversations to monitor.
export function enqueueReferralChecksForAll(db: DB, deps: { startExecutor?: typeof startExecutor } = {}): number[] {
  const ids: number[] = [];
  for (const u of listUsers(db)) {
    const id = enqueueReferralCheck(db, u.id, deps);
    if (id != null) ids.push(id);
  }
  return ids;
}

// Twice a day (local time). Pure so the tick route can be unit-tested: returns the slot key
// ("YYYY-MM-DD@9" / "@18") that is due right now and not yet fired, else null.
export const CHECK_HOURS = [9, 18] as const;
export function dueSlot(now: Date, fired: Set<string>): string | null {
  const h = now.getHours();
  if (!(CHECK_HOURS as readonly number[]).includes(h) || now.getMinutes() >= 5) return null;
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}@${h}`;
  return fired.has(key) ? null : key;
}
