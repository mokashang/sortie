import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listOutreach } from "@/network/crm";
import { updateDraft } from "@/network/gate";
import { withUser, failResponse } from "@/lib/actor";

// GET ?personId=&jobId=&status= — the CRM UI's outreach history / draft-approval feed.
export const GET = withUser(async (req, { userId }) => {
  const url = new URL(req.url);
  const personId = url.searchParams.get("personId");
  const jobId = url.searchParams.get("jobId");
  const status = url.searchParams.get("status") ?? undefined;
  // ?jobLinked=false — /network's view: coffee-chat / hidden-opportunity only; referral (job-
  // linked) outreach lives on /apply's 内推进行中 board.
  const jobLinkedParam = url.searchParams.get("jobLinked");
  const jobLinked = jobLinkedParam === "false" ? false : jobLinkedParam === "true" ? true : undefined;
  try {
    const outreach = listOutreach(getDb(), userId, {
      personId: personId ? Number(personId) : undefined,
      jobId: jobId ? Number(jobId) : undefined,
      status,
      jobLinked,
    });
    return NextResponse.json({ outreach });
  } catch (e) {
    return failResponse(e);
  }
});

// PUT {outreachId, draft} — save an edited draft. Only legal while the outreach is still in
// 'draft' status (updateDraft's own gate enforces this); this is Task 4's "edit before approve"
// flow, implemented here on the outreach route per the plan's note.
export const PUT = withUser(async (req, { userId }) => {
  try {
    const body = await req.json();
    updateDraft(
      getDb(),
      userId,
      Number(body.outreachId),
      String(body.draft),
      body.draftNote === undefined ? undefined : body.draftNote == null ? null : String(body.draftNote)
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
