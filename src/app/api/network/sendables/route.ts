import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sendables } from "@/network/gate";
import { leaseSendables } from "@/network/send-lease";
import { sessionOfCaller } from "@/executor/sessions";
import { isSessionReachable } from "@/executor/attended";
import { withUser, failResponse } from "@/lib/actor";

// GET — the network-executor skill's polling endpoint: every approved (pending_send) outreach.
// ?jobLinked=false narrows to non-referral rows (the /network page's own list); the executor
// polls without the param and sees everything. A dispatcher-spawned session gets only the rows
// no other live session holds, and holds them for a while (src/network/send-lease.ts): with
// tasks running side by side, two resume phases must not send the same message.
export const GET = withUser(async (req, actor) => {
  try {
    const p = new URL(req.url).searchParams.get("jobLinked");
    const jobLinked = p === "false" ? false : p === "true" ? true : undefined;
    const db = getDb();
    const rows = sendables(db, actor.userId, { jobLinked });
    const caller = sessionOfCaller(db, actor);
    return NextResponse.json({ sendables: caller ? leaseSendables(db, rows, caller, (s) => isSessionReachable(s)) : rows });
  } catch (e) {
    return failResponse(e);
  }
});
