import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { loadProfile } from "@/lib/profile";
import { generateDraft } from "@/network/draft";
import { withUser, failResponse } from "@/lib/actor";

// POST {personId, playbook, jobId?, channel?} — the "AI 草稿" button (Task 4). Runs the live
// backend synchronously; the plan's own budget for this is 30s.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    const db = getDb();
    const result = await generateDraft(db, {
      userId,
      backend: getBackend(),
      profile: loadProfile(db, userId),
      personId: Number(body.personId),
      playbook: body.playbook,
      jobId: body.jobId ? Number(body.jobId) : undefined,
      channel: body.channel,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return failResponse(e);
  }
});
