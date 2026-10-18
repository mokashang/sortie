import { NextResponse } from "next/server";
import { readJsonBody } from "@/lib/request-body";
import { getDb } from "@/lib/db";
import { inviteBudget, markInviteCooldown, inviteBudgetMessage } from "@/apply/invite-budget";
import { withUser, failResponse } from "@/lib/actor";

// GET → today's LinkedIn invite budget {limit, used, left, exhausted, cooldownUntil, resetsAt}.
// POST {limited:true, reason} — the session saw LinkedIn's own brakes (weekly invite limit, a
// "verify you're human" check, an unusual-activity notice): no more invites until tomorrow. The
// task does not stop: the session goes on with the plan's direct entries (src/apply/invite-budget.ts).
// Body via readJsonBody: the reason may carry non-ASCII from a Windows curl (src/lib/request-body.ts).
export const GET = withUser(async (_req, { userId }) => {
  try {
    return NextResponse.json(inviteBudget(getDb(), userId));
  } catch (e) {
    return failResponse(e);
  }
});

export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await readJsonBody(req);
    if (body.limited !== true) return NextResponse.json({ error: "expected {limited:true, reason}" }, { status: 400 });
    const budget = markInviteCooldown(getDb(), userId, String(body.reason ?? ""));
    return NextResponse.json({ ...budget, message: inviteBudgetMessage(budget) });
  } catch (e) {
    return failResponse(e);
  }
});
