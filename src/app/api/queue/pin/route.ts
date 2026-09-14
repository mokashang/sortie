import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { setPinned } from "@/apply/queue";
import { withUser, failResponse } from "@/lib/actor";

// User -> App: the ★ "置顶/优先" toggle on /queue rows. Pinned rows sort first both in the
// /queue list and in takeNextApplication's picker (see queue.ts's a.pinned DESC comments).
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    setPinned(getDb(), userId, Number(body.jobId), Boolean(body.pinned));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
