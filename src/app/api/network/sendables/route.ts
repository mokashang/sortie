import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sendables } from "@/network/gate";

// GET — the network-executor skill's polling endpoint: every approved (pending_send) outreach.
// ?jobLinked=false narrows to non-referral rows (the /network page's own list); the executor
// polls without the param and sees everything.
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams.get("jobLinked");
    const jobLinked = p === "false" ? false : p === "true" ? true : undefined;
    return NextResponse.json({ sendables: sendables(getDb(), { jobLinked }) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
