import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { unarchive } from "@/apply/queue";
import { withUser, failResponse } from "@/lib/actor";

// User -> App: the "撤销" undo link shown for ~8s after a row is archived from /queue.
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    unarchive(getDb(), userId, Number(body.jobId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
