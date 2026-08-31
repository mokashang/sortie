import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { decide } from "@/apply/queue";

// User -> App from the in-app confirmation queue: approve or reject a filled application.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    decide(getDb(), Number(body.jobId), body.decision, body.reason);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
