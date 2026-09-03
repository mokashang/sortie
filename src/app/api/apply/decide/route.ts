import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { decideAndMaybeAutoStart } from "@/apply/decide-auto-start";

// User -> App from the in-app confirmation queue: approve or reject a filled application. See
// decideAndMaybeAutoStart for the auto-start-on-approve behavior — factored into its own module
// (rather than living here) so it stays importable from tests without going through Next's
// route-type validation, which only tolerates the recognized HTTP-verb exports on route.ts.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    const result = decideAndMaybeAutoStart(getDb(), Number(body.jobId), body.decision, body.reason);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
