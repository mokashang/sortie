import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordExternalSubmission } from "@/apply/history";
import { withUser, failResponse } from "@/lib/actor";

// User -> App from a 待处理 card's 「我自己投完了」: {jobId}. The user finished the form by hand,
// so the application moves into the post-submit lifecycle (dated now) and shows on /history.
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    recordExternalSubmission(getDb(), userId, Number(body.jobId), "用户自己在网站上提交了这份申请");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
