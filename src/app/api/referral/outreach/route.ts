import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { loadProfile } from "@/lib/profile";
import { PersonInputSchema } from "@/network/crm";
import { createReferralOutreach } from "@/apply/referral";
import { withUser, failResponse } from "@/lib/actor";

// Session -> App: found a person at the company; upsert them, draft the referral request
// (App-side draft engine, ~30s), link the jobs. The draft then waits for the user's approval on
// /apply's 内推进行中 card — nothing is sent from here.
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
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return failResponse(e);
  }
});
