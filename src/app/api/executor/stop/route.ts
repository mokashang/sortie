import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { stopExecutor } from "@/executor/runner";

// POST {runId} — stops a running executor session (SIGTERM to its process group) and marks the
// row 'stopped'.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    stopExecutor(getDb(), Number(body.runId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
