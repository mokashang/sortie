import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJsonBody } from "@/lib/request-body";
import { withKeyedLock } from "@/lib/keyed-lock";
import { getBackend } from "@/llm/registry";
import { loadProfile } from "@/lib/profile";
import { serverLang } from "@/lib/prefs";
import { notify } from "@/lib/notify";
import { harvestOutreach, HarvestMessage } from "@/network/harvest";
import { followUpAfterHarvest, followupNotification, AfterHarvestResult } from "@/network/followup";
import { resolveReferrals } from "@/apply/referral-auto";
import { leaseSendables, FOLLOWUP_LEASE_KEY } from "@/network/send-lease";
import { sessionOfCaller } from "@/executor/sessions";
import { isSessionReachable } from "@/executor/attended";
import { withUser, failResponse } from "@/lib/actor";

// The session copies a message's time off LinkedIn, which shows "10:42 AM", "Mon" or "Oct 7" as
// often as a date. Only a real, plausible instant is kept (as ISO, so the thread sorts by text);
// anything else is left out and the App stamps the harvest time. "Oct 7" parses as 2001 and
// would make a nudge due at once — hence the window.
function harvestedAt(at: unknown): string | undefined {
  if (typeof at !== "string" || !at.trim()) return undefined;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return undefined;
  if (ms < Date.parse("2024-01-01T00:00:00Z") || ms > Date.now() + 86_400_000) return undefined;
  return new Date(ms).toISOString();
}

// Session -> App: what LinkedIn shows for one referral outreach right now — whether the invite
// was accepted and any messages (both directions) in the thread. Read-only on LinkedIn; the App
// merges, moves status and classifies the stage, then decides whether the candidate owes the
// next message and drafts it (src/network/followup.ts). The response's `followup` is that
// message: status 'pending_send' (approved by the 自动投递 switch, or by the user earlier) means
// the session sends it in the thread it has open right now and reports it through
// POST /api/referral/followup {action:'sent'}; anything else waits on the user's card. With tasks
// running side by side, an approved follow-up goes to one session only (src/network/send-lease.ts):
// another session reading the same thread gets followup:null and heldElsewhere:true.
export const POST = withUser(async (req, actor) => {
  const { userId } = actor;
  try {
    const body = await readJsonBody(req);
    const messages: HarvestMessage[] = Array.isArray(body.messages)
      ? body.messages
          .filter((m: unknown) => m && typeof m === "object")
          .map((m: { dir: string; at?: string; text: string }) => ({
            dir: m.dir === "received" ? ("received" as const) : ("sent" as const),
            at: harvestedAt(m.at),
            text: String(m.text ?? ""),
          }))
      : [];
    const db = getDb();
    const backend = getBackend();
    const outreachId = Number(body.outreachId);
    // One harvest of a thread at a time: two parallel sessions reading the same conversation both
    // planned a reply and drafted different texts, so the send guard (exact text) let both out.
    // Serialized, the second one finds the first one's follow-up and plans nothing.
    return await withKeyedLock(`outreach:${outreachId}`, async () => {
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
      // What they said may settle the company: a yes → apply with the referral, everyone out →
      // apply directly (src/apply/referral-auto.ts). Never fails the harvest.
      try {
        resolveReferrals(db, userId);
      } catch (e) {
        console.warn("[referral harvest] auto-resolve failed:", e);
      }
      let followup = after?.followup ?? null;
      let heldElsewhere = false;
      const caller = followup?.status === "pending_send" ? sessionOfCaller(db, actor) : null;
      if (followup && caller && leaseSendables(db, [followup], caller, (s) => isSessionReachable(s), Date.now(), FOLLOWUP_LEASE_KEY).length === 0) {
        followup = null;
        heldElsewhere = true;
      }
      return NextResponse.json({
        ...result,
        followup,
        heldElsewhere,
        autoApproved: after?.autoApproved ?? false,
        nextNudgeAt: after?.plan.action === "none" ? after.plan.nextNudgeAt ?? null : null,
      });
    });
  } catch (e) {
    return failResponse(e);
  }
});
