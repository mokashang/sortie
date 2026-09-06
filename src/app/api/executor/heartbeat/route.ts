import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordHeartbeat } from "@/executor/attended";

// Any interactive attended session (desktop App session or a terminal `claude --chrome`) posts
// {sessionId, kind:'desktop'|'cli'} every ≤10s. A fresh heartbeat tells the dispatcher not to
// spawn a CLI session of its own — the live session will claim queued runs itself.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sessionId = String(body.sessionId ?? "").slice(0, 80);
  const kind = body.kind === "cli" ? "cli" : "desktop";
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  recordHeartbeat(getDb(), sessionId, kind);
  return NextResponse.json({ ok: true });
}
