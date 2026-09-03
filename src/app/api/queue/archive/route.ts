import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { archiveFromQueue } from "@/apply/queue";

// User -> App: the interactive /queue page's row-level "跳过/归档" action. Only valid from
// status='matched' — see archiveFromQueue's own comment for the state-machine detail.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    archiveFromQueue(getDb(), Number(body.jobId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
