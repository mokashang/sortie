import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sendables } from "@/network/gate";

// GET — the network-executor skill's polling endpoint: every approved (pending_send) outreach.
export async function GET() {
  try {
    return NextResponse.json({ sendables: sendables(getDb()) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
