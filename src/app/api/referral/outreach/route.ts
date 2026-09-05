import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { loadProfile } from "@/lib/profile";
import { PersonInputSchema } from "@/network/crm";
import { createReferralOutreach } from "@/apply/referral";

// Session -> App: found a person at the company; upsert them, draft the referral request
// (App-side draft engine, ~30s), link the jobs. The draft then waits for the user's approval on
// /apply's 内推进行中 card — nothing is sent from here.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const person = PersonInputSchema.parse(body.person);
    const jobIds = (body.jobIds as unknown[]).map(Number);
    const result = await createReferralOutreach(getDb(), {
      backend: getBackend(),
      profile: loadProfile(),
      jobIds,
      person,
      channel: body.channel,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
