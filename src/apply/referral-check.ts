import { DB } from "@/lib/db";
import { referralChecklist } from "@/network/harvest";
import { startExecutor, StartOptions } from "@/executor/runner";

// Enqueue a 'referral_check' attended run (kind handled by CLAUDE.md §3.10 i) when there is
// something to check and no such run is already queued/running. Returns the run id or null.
export function enqueueReferralCheck(db: DB, deps: { startExecutor?: typeof startExecutor } = {}): number | null {
  if (referralChecklist(db).length === 0) return null;
  const live = db
    .prepare("SELECT id FROM executor_runs WHERE kind = 'referral_check' AND status IN ('queued','running')")
    .get() as { id: number } | undefined;
  if (live) return null;
  const start = deps.startExecutor ?? startExecutor;
  const options: StartOptions = {};
  return start(db, "referral_check", options, {}, "user_chrome").id;
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
