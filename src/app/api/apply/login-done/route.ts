import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveLogins } from "@/apply/info";
import { maybeAutoStartApply } from "@/apply/decide-auto-start";
import { withUser, failResponse } from "@/lib/actor";

// User -> App from a 登录一次 card: {host}, or {hosts:[…]} from 「全部登好了」. The user signed in
// / registered on those sites in their own Chrome, so every paused application of theirs behind
// those walls is cleared and re-queued as one targeted run (nothing spawns if a run is already
// live or queued — the next run takes them).
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    const db = getDb();
    const hosts = Array.isArray(body.hosts) ? body.hosts.map((h: unknown) => String(h ?? "")) : [String(body.host ?? "")];
    const result = resolveLogins(db, userId, hosts);
    const started =
      result.jobIds.length > 0 ? maybeAutoStartApply(db, userId, { jobIds: result.jobIds, mode: "direct" }) : { autoStarted: false };
    return NextResponse.json({ ok: true, ...result, ...started });
  } catch (e) {
    return failResponse(e);
  }
});
