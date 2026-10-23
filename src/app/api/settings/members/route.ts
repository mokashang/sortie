import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { membersMayUseBackground, setMembersMayUseBackground } from "@/executor/member-policy";
import { withUser, failResponse, requireOwner, requireBrowser } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// 设置 → 其他账号: may accounts other than the owner apply through the background browser on this
// machine (src/executor/member-policy.ts)? Box-wide and the owner's call, like the AI provider.
export const GET = withUser(async () => {
  return NextResponse.json({ background: membersMayUseBackground(getDb()) });
});

export const POST = withUser(async (req, actor) => {
  requireBrowser(actor);
  try {
    requireOwner(actor);
    const body = (await readJsonBody(req)) as { background?: unknown };
    if (typeof body.background !== "boolean") return NextResponse.json({ error: "background must be a boolean" }, { status: 400 });
    const db = getDb();
    setMembersMayUseBackground(db, body.background);
    return NextResponse.json({ background: membersMayUseBackground(db) });
  } catch (e) {
    return failResponse(e);
  }
});
