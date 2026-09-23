import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { loadProfile } from "@/lib/profile";
import { PersonInputSchema } from "@/network/crm";
import { createReferralOutreach } from "@/apply/referral";
import { withUser, failResponse } from "@/lib/actor";
import { autoApproveOutreachIfEnabled } from "@/apply/auto-submit";

// Session -> App: found a person at the company; upsert them, draft the referral request
// (App-side draft engine, ~30s), link the jobs. The draft then waits for the user's approval on
// /apply's 内推进行中 card — nothing is sent from here. With 自动投递 on (src/apply/auto-submit.ts)
// the App approves the draft itself and the response carries autoApproved:true + status
// 'pending_send', so the session sends it right away instead of polling.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    const person = PersonInputSchema.parse(body.person);
    const jobIds = (body.jobIds as unknown[]).map(Number);
    const db = getDb();
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
