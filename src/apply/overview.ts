import type { DB } from "@/lib/db";
import { executorStatus } from "@/executor/runner";
import { pendingInfo } from "@/apply/info";
import { planAlerts } from "@/apply/plan-alerts";
import { referralBoard } from "@/apply/referral";
import { queueMatchedCount } from "@/apply/queue";
import { todaySubmitted } from "@/apply/history";
import { weekly } from "@/network/stats";
import { JOB_LINKED_SQL } from "@/network/crm";
import { profileStatus } from "@/lib/profile";
import { attendedParallel } from "@/executor/sessions";
import { attendedAvailable } from "@/executor/channel";
import { ownerId } from "@/lib/users";
import { uploadedResumePath } from "@/apply/resume-select";

// One read for the app shell: badge counts for the sidebar, the numbers on the 今日 page, and
// which assistant task (if any) is in flight. Composed entirely from existing read functions,
// all scoped to the acting account.
// The response types (and attentionTotal) live in src/app/lib/overview-types.ts so the client
// can import them without pulling this module's db dependencies into the browser bundle.
import type { Overview, OverviewCounts, SetupProgress } from "@/app/lib/overview-types";
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

  // Conversation-only cards (jobs already off the board, a message still waiting) are counted by
  // referralDrafts below, not as jobs in flight.
  const cards = referralBoard(db, userId).filter((c) => !c.conversationOnly);
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
    planAlerts: planAlerts(db, userId).length,
    // First messages to approve plus later ones in a conversation (a reply to approve, or a
    // question only the user can answer — src/network/followup.ts).
    referralDrafts:
      count(db, `SELECT COUNT(*) n FROM outreach o WHERE o.user_id = ? AND o.status = 'draft' AND ${JOB_LINKED_SQL}`, userId) +
      count(db, "SELECT COUNT(*) n FROM outreach_followups WHERE user_id = ? AND status IN ('draft','needs_user')", userId),
    referralProgress,
    referralInFlight,
    networkDrafts: count(db, `SELECT COUNT(*) n FROM outreach o WHERE o.user_id = ? AND o.status = 'draft' AND NOT ${JOB_LINKED_SQL}`, userId),
    networkPendingSend: count(
      db,
      `SELECT COUNT(*) n FROM outreach o WHERE o.user_id = ? AND o.status = 'pending_send' AND NOT ${JOB_LINKED_SQL}`,
      userId
    ),
    queueMatched: queueMatchedCount(db, userId),
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
    chromeAvailable: attendedAvailable(db, userId),
    isOwner: ownerId(db) === userId,
    setup: setupProgress(db, userId),
  };
}

// Where a new account stands on the way to its first submitted application (null once there is
// one — the checklist has done its job, and the owner's busy account never pays for the counts).
function setupProgress(db: DB, userId: string): SetupProgress | null {
  if (db.prepare("SELECT 1 FROM applications WHERE user_id = ? AND submitted_at IS NOT NULL LIMIT 1").get(userId)) return null;
  return {
    experiences: count(db, "SELECT COUNT(*) n FROM experiences WHERE user_id = ?", userId),
    hasResume: uploadedResumePath(db, userId) != null || count(db, "SELECT COUNT(*) n FROM resumes WHERE user_id = ?", userId) > 0,
    scored: count(db, "SELECT COUNT(*) n FROM matches WHERE user_id = ?", userId),
    applyStarted: count(db, "SELECT COUNT(*) n FROM executor_runs WHERE user_id = ? AND kind = 'apply'", userId) > 0,
  };
}
