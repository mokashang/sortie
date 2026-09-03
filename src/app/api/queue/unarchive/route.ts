import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { unarchive } from "@/apply/queue";

// User -> App: the "撤销" undo link shown for ~8s after a row is archived from /queue.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    unarchive(getDb(), Number(body.jobId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
