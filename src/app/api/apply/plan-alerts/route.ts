import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { planAlerts, resolvePlanAlert } from "@/apply/plan-alerts";
import { ExecutorStartError } from "@/executor/runner";
import { withUser, failResponse } from "@/lib/actor";
import { langFromRequest, messagesFor } from "@/i18n/server";
import { readJsonBody } from "@/lib/request-body";

// GET → the task-level 待处理 cards (a plan that stopped short, a task that gave up with jobs
// untouched — src/apply/plan-alerts.ts). POST {runId, action:'continue'|'dismiss'} → the card's
// buttons; continue answers {runId} of the task it queued.
export const GET = withUser(async (_req, { userId }) => {
  try {
    return NextResponse.json({ alerts: planAlerts(getDb(), userId) });
  } catch (e) {
    return failResponse(e);
  }
});

export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await readJsonBody(req);
    const action = body.action === "continue" ? "continue" : body.action === "dismiss" ? "dismiss" : null;
    if (!action) return NextResponse.json({ error: "action must be 'continue' or 'dismiss'" }, { status: 400 });
    return NextResponse.json(resolvePlanAlert(getDb(), userId, Number(body.runId), action));
  } catch (e) {
    if (e instanceof ExecutorStartError) return NextResponse.json({ error: messagesFor(langFromRequest(req)).errors[e.code] }, { status: 400 });
    return failResponse(e);
  }
});
