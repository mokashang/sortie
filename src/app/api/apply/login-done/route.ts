import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveLogin } from "@/apply/info";
import { maybeAutoStartApply } from "@/apply/decide-auto-start";
import { withUser, failResponse } from "@/lib/actor";

// User -> App from a 登录一次 card: {host, note?} (note = a message to the assistant for these
// jobs, e.g. "sign in with Google", stored as custom.assistant_note). The user signed in / registered on that site in their
// own Chrome, so every paused application of theirs behind that wall is cleared and re-queued as
// one targeted run (nothing spawns if a run is already live or queued — the next run takes them).
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    const db = getDb();
    const result = resolveLogin(db, userId, String(body.host ?? ""), typeof body.note === "string" ? body.note : undefined);
    const started =
      result.jobIds.length > 0 ? maybeAutoStartApply(db, userId, { jobIds: result.jobIds, mode: "direct" }) : { autoStarted: false };
    return NextResponse.json({ ok: true, ...result, ...started });
  } catch (e) {
    return failResponse(e);
  }
});
