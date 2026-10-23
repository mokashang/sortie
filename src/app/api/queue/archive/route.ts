import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { archiveFromQueue } from "@/apply/queue";
import { withUser, failResponse } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// User -> App: the interactive /queue page's row-level "跳过/归档" action. Only valid from
// status='matched' — see archiveFromQueue's own comment for the state-machine detail.
export const POST = withUser(async (req, { userId }) => {
  const body = await readJsonBody(req);
  try {
    archiveFromQueue(getDb(), userId, Number(body.jobId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
