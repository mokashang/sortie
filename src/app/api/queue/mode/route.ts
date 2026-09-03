import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { setApplyMode, isApplyMode } from "@/apply/mode";

// POST {jobId, mode: 'referral'|'direct'|null} — /queue's 改为找内推 / 改为海投 / 跟随建议.
export async function POST(req: Request) {
  const body = await req.json();
  try {
    const mode = body.mode == null ? null : body.mode;
    if (mode !== null && !isApplyMode(mode)) throw new Error(`invalid mode '${mode}'`);
    setApplyMode(getDb(), Number(body.jobId), mode);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
