import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listOutreach } from "@/network/crm";
import { updateDraft } from "@/network/gate";

// GET ?personId=&jobId=&status= — the CRM UI's outreach history / draft-approval feed.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const personId = url.searchParams.get("personId");
  const jobId = url.searchParams.get("jobId");
  const status = url.searchParams.get("status") ?? undefined;
  try {
    const outreach = listOutreach(getDb(), {
      personId: personId ? Number(personId) : undefined,
      jobId: jobId ? Number(jobId) : undefined,
      status,
    });
    return NextResponse.json({ outreach });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

// PUT {outreachId, draft} — save an edited draft. Only legal while the outreach is still in
// 'draft' status (updateDraft's own gate enforces this); this is Task 4's "edit before approve"
// flow, implemented here on the outreach route per the plan's note.
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    updateDraft(getDb(), Number(body.outreachId), String(body.draft));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
