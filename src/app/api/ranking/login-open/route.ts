import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { rankedLoginUrl } from "@/apply/ranking";
import { openUrlsInJobChrome } from "@/executor/open-profile";
import { withUser, failResponse, requireOwner } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// 去登录 on a 天梯 row: {jobId}. Opens that job's sign-in page as a tab of the job-search Chrome on
// this machine, where the assistant fills forms. The URL comes from the job's own login item.
export const POST = withUser(async (req, actor) => {
  requireOwner(actor);
  const body = await readJsonBody(req);
  try {
    const url = rankedLoginUrl(getDb(), actor.userId, Number(body.jobId));
    if (!url) return NextResponse.json({ error: "this job has no sign-in page on record", code: "no_login_url" }, { status: 404 });
    openUrlsInJobChrome([url]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
