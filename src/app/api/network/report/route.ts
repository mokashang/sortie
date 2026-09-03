import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reportReply } from "@/network/gate";
import { reportSentAndMarkReached } from "@/apply/referral-glue";

// POST {outreachId, event: 'sent'|'reply', text?} — executor -> App status reports.
// For event='sent', `text` is optional and, when present, is the *actual* text that went out
// (e.g. a LinkedIn connection note trimmed to fit 280 chars) — passed through to reportSent so
// thread_log records what was really sent rather than the full, possibly-longer draft.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const outreachId = Number(body.outreachId);
    if (body.event === "sent") {
      // reportSent is the red-line gate; markReached then stamps any linked referral jobs.
      reportSentAndMarkReached(getDb(), outreachId, body.text != null ? String(body.text) : undefined);
    } else if (body.event === "reply") {
      reportReply(getDb(), outreachId, String(body.text ?? ""));
    } else {
      throw new Error(`report: invalid event '${body.event}' (must be 'sent' or 'reply')`);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
