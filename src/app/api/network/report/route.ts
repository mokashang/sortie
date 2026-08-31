import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { reportSent, reportReply } from "@/network/gate";

// POST {outreachId, event: 'sent'|'reply', text?} — executor -> App status reports.
export async function POST(req: Request) {
  const body = await req.json();
  const outreachId = Number(body.outreachId);
  try {
    if (body.event === "sent") {
      reportSent(getDb(), outreachId);
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
