import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { retryRankedLogin } from "@/apply/ranking";
import { withUser, failResponse } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// 登好了,重试 on a 天梯 row: {jobId}. The site's wall comes down and the list's jobs on it go to
// the assistant (src/apply/ranking.ts retryRankedLogin).
export const POST = withUser(async (req, { userId }) => {
  const body = await readJsonBody(req);
  try {
    return NextResponse.json({ ok: true, ...retryRankedLogin(getDb(), userId, Number(body.jobId)) });
  } catch (e) {
    return failResponse(e);
  }
});
