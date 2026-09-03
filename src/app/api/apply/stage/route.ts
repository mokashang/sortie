import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { setStage } from "@/apply/history";

// User -> App from /history's per-row status selector: {jobId, stage, note?}. Only post-submit
// applications may move, and only between post-submit stages — see setStage.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    setStage(getDb(), Number(body.jobId), String(body.stage ?? ""), body.note ?? null);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
