import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// Session polls this (every 5s, ≤30 min) after creating an outreach: status becomes
// 'pending_send' once the user approved it on /apply, 'archived' if rejected.
export async function GET(req: Request) {
  const id = Number(new URL(req.url).searchParams.get("outreachId"));
  const row = getDb().prepare("SELECT status, draft, draft_note FROM outreach WHERE id = ?").get(id) as
    | { status: string; draft: string | null; draft_note: string | null }
    | undefined;
  if (!row) return NextResponse.json({ error: `no outreach ${id}` }, { status: 404 });
  return NextResponse.json(row);
}
