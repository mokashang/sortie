import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveLogin } from "@/apply/info";
import { maybeAutoStartApply } from "@/apply/decide-auto-start";

// User -> App from a 登录一次 card: {host}. The user signed in / registered on that site in their
// own Chrome, so every paused application behind that wall is cleared and re-queued as one
// targeted run (nothing spawns if a run is already live or queued — the next run takes them).
export async function POST(req: Request) {
  const body = await req.json();
  try {
    const db = getDb();
    const result = resolveLogin(db, String(body.host ?? ""));
    const started = result.jobIds.length > 0 ? maybeAutoStartApply(db, { jobIds: result.jobIds, mode: "direct" }) : { autoStarted: false };
    return NextResponse.json({ ok: true, ...result, ...started });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
