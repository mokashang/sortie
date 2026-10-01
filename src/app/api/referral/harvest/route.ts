import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJsonBody } from "@/lib/request-body";
import { getBackend } from "@/llm/registry";
import { loadProfile } from "@/lib/profile";
import { serverLang } from "@/lib/prefs";
import { notify } from "@/lib/notify";
import { harvestOutreach, HarvestMessage } from "@/network/harvest";
import { followUpAfterHarvest, followupNotification, AfterHarvestResult } from "@/network/followup";
import { withUser, failResponse } from "@/lib/actor";

// Session -> App: what LinkedIn shows for one referral outreach right now — whether the invite
// was accepted and any messages (both directions) in the thread. Read-only on LinkedIn; the App
// merges, moves status and classifies the stage, then decides whether the candidate owes the
// next message and drafts it (src/network/followup.ts). The response's `followup` is that
// message: status 'pending_send' (approved by the 自动投递 switch, or by the user earlier) means
// the session sends it in the thread it has open right now and reports it through
// POST /api/referral/followup {action:'sent'}; anything else waits on the user's card.
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await readJsonBody(req);
    const messages: HarvestMessage[] = Array.isArray(body.messages)
      ? body.messages
          .filter((m: unknown) => m && typeof m === "object")
          .map((m: { dir: string; at?: string; text: string }) => ({
            dir: m.dir === "received" ? ("received" as const) : ("sent" as const),
            at: typeof m.at === "string" ? m.at : undefined,
            text: String(m.text ?? ""),
          }))
      : [];
    const db = getDb();
    const backend = getBackend();
    const outreachId = Number(body.outreachId);
    const result = await harvestOutreach(db, { userId, backend, outreachId, accepted: Boolean(body.accepted), messages });

    let after: AfterHarvestResult | null = null;
    try {
      const lang = serverLang();
      after = await followUpAfterHarvest(db, { userId, backend, profile: loadProfile(db, userId), outreachId, lang });
      const who = db
        .prepare("SELECT p.name, p.company FROM outreach o JOIN people p ON p.id = o.person_id WHERE o.id = ?")
        .get(outreachId) as { name: string; company: string | null };
      const n = followupNotification({ person: who.name, company: who.company ?? "", newReceived: result.newReceived, summary: result.summary, after }, lang);
      if (n) void notify(n.title, n.body, { priority: n.priority });
    } catch (e) {
      // An incomplete profile or a drafting hiccup never fails the harvest itself.
      console.warn("[referral harvest] follow-up step failed:", e);
    }
    return NextResponse.json({
      ...result,
      followup: after?.followup ?? null,
      autoApproved: after?.autoApproved ?? false,
      nextNudgeAt: after?.plan.action === "none" ? after.plan.nextNudgeAt ?? null : null,
    });
  } catch (e) {
    return failResponse(e);
  }
});
