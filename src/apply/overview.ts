import type { DB } from "@/lib/db";
import { executorStatus } from "@/executor/runner";
import { pendingInfo } from "@/apply/info";
import { referralBoard } from "@/apply/referral";
import { queueByDirection } from "@/apply/queue";
import { todaySubmitted } from "@/apply/history";
import { weekly } from "@/network/stats";
import { JOB_LINKED_SQL } from "@/network/crm";
import { profileStatus } from "@/lib/profile";
import { attendedParallel } from "@/executor/sessions";

// One read for the app shell: badge counts for the sidebar, the numbers on the 今日 page, and
// which assistant task (if any) is in flight. Composed entirely from existing read functions,
// all scoped to the acting account.
// The response types (and attentionTotal) live in src/app/lib/overview-types.ts so the client
// can import them without pulling this module's db dependencies into the browser bundle.
import type { Overview, OverviewCounts } from "@/app/lib/overview-types";
export { attentionTotal } from "@/app/lib/overview-types";
export type { Overview, OverviewCounts } from "@/app/lib/overview-types";

function count(db: DB, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

export function overview(db: DB, userId: string): Overview {
  const runs = executorStatus(db, userId);
  // Running before queued (runs come newest first): with tasks side by side, the card leads with
  // one that is actually working, not the one just queued behind it.
  const liveRuns = runs.filter((r) => r.status === "running").concat(runs.filter((r) => r.status === "queued"));
  const assistant = liveRuns[0] ?? runs[0] ?? null;
  const liveKinds = [...new Set(liveRuns.map((r) => r.kind))];

  const cards = referralBoard(db, userId);
  const referralInFlight = cards.reduce((n, c) => n + c.jobs.length, 0);
  const referralProgress = cards.reduce(
    (n, c) => n + c.outreaches.filter((o) => o.stage === "will_refer" || o.stage === "referred").length,
    0
  );

  const counts: OverviewCounts = {
    awaitingConfirm: count(db, "SELECT COUNT(*) n FROM applications WHERE user_id = ? AND status = 'awaiting_confirm'", userId),
    approvedWaiting: count(
      db,
      "SELECT COUNT(*) n FROM applications WHERE user_id = ? AND status = 'awaiting_confirm' AND confirm_decision = 'approved'",
      userId
    ),
    needsInfo: pendingInfo(db, userId).length,
    referralDrafts: count(db, `SELECT COUNT(*) n FROM outreach o WHERE o.user_id = ? AND o.status = 'draft' AND ${JOB_LINKED_SQL}`, userId),
    referralProgress,
    referralInFlight,
    networkDrafts: count(db, `SELECT COUNT(*) n FROM outreach o WHERE o.user_id = ? AND o.status = 'draft' AND NOT ${JOB_LINKED_SQL}`, userId),
    networkPendingSend: count(
      db,
      `SELECT COUNT(*) n FROM outreach o WHERE o.user_id = ? AND o.status = 'pending_send' AND NOT ${JOB_LINKED_SQL}`,
      userId
    ),
    queueMatched: queueByDirection(db, userId).reduce((n, g) => n + g.matched, 0),
    submittedToday: todaySubmitted(db, userId).length,
    submittedThisWeek: weekly(db, userId).thisWeek.submittedApplications,
  };

  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    today: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    assistant,
    liveRuns,
    liveKinds,
    parallel: attendedParallel(db),
    counts,
    profileComplete: profileStatus(db, userId).complete,
  };
}
