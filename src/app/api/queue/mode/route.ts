import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { setApplyMode, setApplyModeBulk, isApplyMode } from "@/apply/mode";
import { withUser, failResponse } from "@/lib/actor";

// POST {jobId, mode: 'referral'|'direct'|null} — /queue's 改为找内推 / 改为海投 / 跟随建议.
// POST {jobIds: [...], mode} — the same from the selection bar; answers {changed, skipped}
// (skipped = rows that had already left the queue by the time the user clicked).
export const POST = withUser(async (req, { userId }) => {
  const body = await req.json();
  try {
    const mode = body.mode == null ? null : body.mode;
    if (mode !== null && !isApplyMode(mode)) throw new Error(`invalid mode '${mode}'`);
    if (Array.isArray(body.jobIds)) {
      const result = setApplyModeBulk(getDb(), userId, body.jobIds.map(Number), mode);
      return NextResponse.json({ ok: true, ...result });
    }
    setApplyMode(getDb(), userId, Number(body.jobId), mode);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e);
  }
});
