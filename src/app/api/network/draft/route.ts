import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { loadProfile } from "@/lib/profile";
import { generateDraft } from "@/network/draft";

// POST {personId, playbook, jobId?, channel?} — the "AI 草稿" button (Task 4). Runs the live
// backend synchronously; the plan's own budget for this is 30s.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await generateDraft(getDb(), {
      backend: getBackend(),
      profile: loadProfile(),
      personId: Number(body.personId),
      playbook: body.playbook,
      jobId: body.jobId ? Number(body.jobId) : undefined,
      channel: body.channel,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
