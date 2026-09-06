import type { DB } from "@/lib/db";
import { executorStatus, RunStatusRow } from "@/executor/runner";
import { pendingInfo } from "@/apply/info";
import { referralBoard } from "@/apply/referral";
import { queueByDirection } from "@/apply/queue";
import { todaySubmitted } from "@/apply/history";
import { weekly } from "@/network/stats";
import { JOB_LINKED_SQL } from "@/network/crm";

// One read for the app shell: badge counts for the sidebar, the numbers on the 今日 page, and
// which assistant task (if any) is in flight. Composed entirely from existing read functions.
export interface OverviewCounts {
  awaitingConfirm: number;
  approvedWaiting: number;
  needsInfo: number;
  referralDrafts: number;
  referralProgress: number;
  referralInFlight: number;
  networkDrafts: number;
  networkPendingSend: number;
  manual: number;
  queueMatched: number;
  submittedToday: number;
  submittedThisWeek: number;
}

export interface Overview {
  today: string;
  assistant: RunStatusRow | null;
  counts: OverviewCounts;
}

function count(db: DB, sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

export function overview(db: DB): Overview {
  const runs = executorStatus(db);
  const assistant = runs.find((r) => r.status === "queued" || r.status === "running") ?? runs[0] ?? null;

  const cards = referralBoard(db);
  const referralInFlight = cards.reduce((n, c) => n + c.jobs.length, 0);
  const referralProgress = cards.reduce(
    (n, c) => n + c.outreaches.filter((o) => o.stage === "will_refer" || o.stage === "referred").length,
    0
  );

  const counts: OverviewCounts = {
    awaitingConfirm: count(db, "SELECT COUNT(*) n FROM applications WHERE status = 'awaiting_confirm'"),
    approvedWaiting: count(
      db,
      "SELECT COUNT(*) n FROM applications WHERE status = 'awaiting_confirm' AND confirm_decision = 'approved'"
    ),
    needsInfo: pendingInfo(db).length,
    referralDrafts: count(db, `SELECT COUNT(*) n FROM outreach o WHERE o.status = 'draft' AND ${JOB_LINKED_SQL}`),
    referralProgress,
    referralInFlight,
    networkDrafts: count(db, `SELECT COUNT(*) n FROM outreach o WHERE o.status = 'draft' AND NOT ${JOB_LINKED_SQL}`),
    networkPendingSend: count(
      db,
      `SELECT COUNT(*) n FROM outreach o WHERE o.status = 'pending_send' AND NOT ${JOB_LINKED_SQL}`
    ),
    manual: count(
      db,
      "SELECT COUNT(*) n FROM applications WHERE status = 'matched' AND needs_manual_reason IS NOT NULL AND pending_questions IS NULL"
    ),
    queueMatched: queueByDirection(db).reduce((n, g) => n + g.matched, 0),
    submittedToday: todaySubmitted(db).length,
    submittedThisWeek: weekly(db).thisWeek.submittedApplications,
  };

  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { today: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, assistant, counts };
}

// Things only the user can move forward: unapproved confirmations, unanswered questions,
// unapproved referral drafts, and referral conversations that need a 「有内推了」 decision.
export function attentionTotal(c: OverviewCounts): number {
  return Math.max(0, c.awaitingConfirm - c.approvedWaiting) + c.needsInfo + c.referralDrafts + c.referralProgress;
}
