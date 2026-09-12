import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dispatchAttended, attendedStatus } from "@/executor/attended";

// The dispatcher tick (instrumentation.ts, every 10s): spawn a terminal `claude --chrome` session
// for a queued user_chrome run when no attended session is alive; reap it when its run is done.
//
// Failures are also written to the server log (throttled: once per distinct message per 5 min),
// because the caller is a fire-and-forget timer that never reads this response — a broken spawn
// path stayed invisible for hours that way (node-pty loader, Windows, 2026-09-11).
let lastLoggedError = "";
let lastLoggedAt = 0;
export async function POST() {
  try {
    const r = dispatchAttended(getDb());
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = String(e);
    const now = Date.now();
    if (msg !== lastLoggedError || now - lastLoggedAt > 5 * 60_000) {
      console.error("[attended dispatch] failed:", msg);
      lastLoggedError = msg;
      lastLoggedAt = now;
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(attendedStatus(getDb()));
}
