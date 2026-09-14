import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reportFill, reportSubmitted, ReportFillInput } from "@/apply/queue";
import { reportNoContact } from "@/apply/referral";
import { needsInfoNotification } from "@/apply/info";
import { notify } from "@/lib/notify";
import { withUser, failResponse } from "@/lib/actor";

// Executor -> App: status reports during and after a fill attempt.
// body.status === 'submitted' is routed to reportSubmitted (the red-line gate) instead of
// reportFill, since 'submitted' isn't one of reportFill's accepted statuses.
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    const db = getDb();
    // Referral mode: nobody reachable at this company — jobs stay referral_seeking with the
    // reason shown on the board for the user to decide (直接投 / 微信找 / 放弃).
    if (body.status === "referral_no_contact") {
      const ids = (Array.isArray(body.jobIds) ? body.jobIds : [body.jobId]).map(Number);
      reportNoContact(db, userId, ids, String(body.reason ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (body.status === "submitted") {
      reportSubmitted(db, userId, Number(body.jobId));
    } else {
      reportFill(db, userId, body as ReportFillInput);
      // needs_info: the executor is parked on the form waiting for the user — push a desktop
      // (osascript) + ntfy notification so they come to /apply and answer. Fire-and-forget: a
      // notification hiccup must never fail the report itself.
      if (body.status === "needs_info") {
        const job = db.prepare("SELECT company, title FROM jobs WHERE id = ?").get(Number(body.jobId)) as
          | { company: string; title: string }
          | undefined;
        const n = needsInfoNotification(job?.company ?? "?", job?.title ?? "", body.questions ?? []);
        void notify(n.title, n.body, { priority: "high" });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
