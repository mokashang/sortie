import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { harvestOutreach, HarvestMessage } from "@/network/harvest";
import { withUser, failResponse } from "@/lib/actor";

// Session -> App: what LinkedIn shows for one referral outreach right now — whether the invite
// was accepted and any messages (both directions) in the thread. Read-only on LinkedIn; the App
// merges, moves status and classifies the stage.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    const messages: HarvestMessage[] = Array.isArray(body.messages)
      ? body.messages
          .filter((m: unknown) => m && typeof m === "object")
          .map((m: { dir: string; at?: string; text: string }) => ({
            dir: m.dir === "received" ? ("received" as const) : ("sent" as const),
            at: typeof m.at === "string" ? m.at : undefined,
            text: String(m.text ?? ""),
          }))
      : [];
    const result = await harvestOutreach(getDb(), {
      userId,
      backend: getBackend(),
      outreachId: Number(body.outreachId),
      accepted: Boolean(body.accepted),
      messages,
    });
    return NextResponse.json(result);
  } catch (e) {
    return failResponse(e);
  }
});
