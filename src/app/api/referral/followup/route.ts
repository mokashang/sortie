import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJsonBody } from "@/lib/request-body";
import { getBackend } from "@/llm/registry";
import { loadProfile } from "@/lib/profile";
import { serverLang } from "@/lib/prefs";
import {
  answerFollowup,
  approveFollowup,
  editFollowup,
  followupSendables,
  rejectFollowup,
  reportFollowupSent,
  unapproveFollowup,
} from "@/network/followup";
import { enqueueReferralCheck } from "@/apply/referral-check";
import { leaseSendables, FOLLOWUP_LEASE_KEY } from "@/network/send-lease";
import { sessionOfCaller } from "@/executor/sessions";
import { isSessionReachable } from "@/executor/attended";
import { withUser, failResponse } from "@/lib/actor";

// GET — approved follow-ups waiting to be sent (the attended session's sweep at the end of a
// referral check: open each thread, harvest again, send what the harvest response hands back).
// A dispatcher-spawned session sees only the ones no other live session holds (send-lease.ts).
export const GET = withUser(async (_req, actor) => {
  try {
    const db = getDb();
    const rows = followupSendables(db, actor.userId);
    const caller = sessionOfCaller(db, actor);
    return NextResponse.json({
      followups: caller ? leaseSendables(db, rows, caller, (s) => isSessionReachable(s), Date.now(), FOLLOWUP_LEASE_KEY) : rows,
    });
  } catch (e) {
    return failResponse(e);
  }
});

// POST {followupId, action, text?, answer?}
//   approve [text]  — the user's 批准发送 on the card (text = their edit, applied first); queues a
//                     referral check so a session goes and sends it
//   unapprove       — back to draft to edit
//   reject          — don't send; this point in the conversation is left alone
//   edit text       — save an edit without approving
//   answer answer   — the user answered the question only they could; the App drafts the reply
//   sent [text]     — session -> App after the message went out (RED LINE: pending_send only)
export const POST = withUser(async (req, { userId }) => {
  try {
    const body = await readJsonBody(req);
    const db = getDb();
    const id = Number(body.followupId);
    switch (body.action) {
      case "approve": {
        if (typeof body.text === "string" && body.text.trim()) editFollowup(db, userId, id, body.text);
        const followup = approveFollowup(db, userId, id);
        const runId = enqueueReferralCheck(db, userId);
        return NextResponse.json({ ok: true, followup, queued: runId != null, runId });
      }
      case "unapprove":
        return NextResponse.json({ ok: true, followup: unapproveFollowup(db, userId, id) });
      case "reject":
        return NextResponse.json({ ok: true, followup: rejectFollowup(db, userId, id) });
      case "edit":
        return NextResponse.json({ ok: true, followup: editFollowup(db, userId, id, String(body.text ?? "")) });
      case "answer": {
        const r = await answerFollowup(db, {
          userId,
          backend: getBackend(),
          profile: loadProfile(db, userId),
          lang: serverLang(),
          id,
          answer: String(body.answer ?? ""),
        });
        const runId = r.autoApproved ? enqueueReferralCheck(db, userId) : null;
        return NextResponse.json({ ok: true, ...r, queued: runId != null, runId });
      }
      case "sent":
        return NextResponse.json({ ok: true, followup: reportFollowupSent(db, userId, id, body.text != null ? String(body.text) : undefined) });
      default:
        throw new Error(`followup: invalid action '${String(body.action)}' (approve|unapprove|reject|edit|answer|sent)`);
    }
  } catch (e) {
    return failResponse(e);
  }
});
