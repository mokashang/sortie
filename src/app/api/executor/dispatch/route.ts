import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchAttended, attendedStatus } from "@/executor/attended";

// The dispatcher tick (instrumentation.ts, every 10s): spawn a terminal `claude --chrome` session
// for a queued user_chrome run when no attended session is alive; reap it when its run is done.
export async function POST() {
  try {
    const r = dispatchAttended(getDb());
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(attendedStatus(getDb()));
}
