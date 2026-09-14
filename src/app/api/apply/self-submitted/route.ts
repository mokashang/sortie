import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordExternalSubmission } from "@/apply/history";

// User -> App from a 待处理 card's 「我自己投完了」: {jobId}. The user finished the form by hand,
// so the application moves into the post-submit lifecycle (dated now) and shows on /history.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    recordExternalSubmission(getDb(), Number(body.jobId), "用户自己在网站上提交了这份申请");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
