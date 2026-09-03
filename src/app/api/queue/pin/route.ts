import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { setPinned } from "@/apply/queue";

// User -> App: the ★ "置顶/优先" toggle on /queue rows. Pinned rows sort first both in the
// /queue list and in takeNextApplication's picker (see queue.ts's a.pinned DESC comments).
export async function POST(req: Request) {
  const body = await req.json();
  try {
    setPinned(getDb(), Number(body.jobId), Boolean(body.pinned));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
