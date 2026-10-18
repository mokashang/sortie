import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { loadProfile } from "@/lib/profile";
import { PersonInputSchema } from "@/network/crm";
import { createReferralOutreach } from "@/apply/referral";
import { withUser, failResponse } from "@/lib/actor";
import { autoApproveOutreachIfEnabled } from "@/apply/auto-submit";
import { readJsonBody } from "@/lib/request-body";
import { inviteBudget, inviteBudgetMessage, isTargetedReferral, releaseUncontacted } from "@/apply/invite-budget";

// Session -> App: found a person at the company; upsert them, draft the referral request
// (App-side draft engine, ~30s), link the jobs. The draft then waits for the user's approval on
// /apply's 内推进行中 card — nothing is sent from here. With 自动投递 on (src/apply/auto-submit.ts)
// the App approves the draft itself and the response carries autoApproved:true + status
// 'pending_send', so the session sends it right away instead of polling.
//
// Today's LinkedIn invite budget (src/apply/invite-budget.ts) is checked here too, not only when
// the company is picked: three people per company, or another task spending invites meanwhile,
// would otherwise run past it. Past the budget the answer is 409 invite_budget_exhausted, and a
// company nobody got asked at yet goes back to the queue for tomorrow. Targeted runs (the user's
// 换人再问) are exempt.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await readJsonBody(req);
    const person = PersonInputSchema.parse(body.person);
    const jobIds = (body.jobIds as unknown[]).map(Number);
    const db = getDb();
    if ((body.channel ?? "linkedin") === "linkedin" && !isTargetedReferral(db, userId, jobIds)) {
      const budget = inviteBudget(db, userId);
      if (budget.exhausted) {
        const released = releaseUncontacted(db, userId, jobIds);
        return NextResponse.json(
          { error: "invite_budget_exhausted", message: inviteBudgetMessage(budget), inviteBudget: budget, released },
          { status: 409 }
        );
      }
    }
    const result = await createReferralOutreach(db, userId, {
      backend: getBackend(),
      profile: loadProfile(db, userId),
      jobIds,
      person,
      channel: body.channel,
    });
    const autoApproved = autoApproveOutreachIfEnabled(db, userId, result.outreachId);
    return NextResponse.json({ ...result, autoApproved, status: autoApproved ? "pending_send" : "draft" }, { status: 201 });
  } catch (e) {
    return failResponse(e);
  }
});
