import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { shortenNote } from "@/network/draft";

// Session -> App: the live LinkedIn dialog shows a note cap smaller than the approved note (free
// accounts: 200 chars). The App re-compresses the approved text itself — the session never edits
// message text — and the row stays pending_send, so the send gate is unaffected.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = await shortenNote(getDb(), {
      backend: getBackend(),
      outreachId: Number(body.outreachId),
      max: Number(body.max) || 200,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
