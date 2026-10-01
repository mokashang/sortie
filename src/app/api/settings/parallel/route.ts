import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { attendedParallel, setAttendedParallel } from "@/executor/sessions";
import { isParallelChoice, PARALLEL_CHOICES } from "@/app/lib/parallel";
import { withUser, failResponse, requireOwner } from "@/lib/actor";

// 设置 → 同时进行的任务: how many apply tasks run at once, one attended session each
// (src/executor/attended.ts). Box-wide, like the AI provider: the dispatcher serves the owner's
// Chrome, so only the owner sets it.
export const GET = withUser(async () => {
  return NextResponse.json({ value: attendedParallel(getDb()), choices: PARALLEL_CHOICES });
});

export const POST = withUser(async (req, actor) => {
  try {
    requireOwner(actor);
    const body = (await req.json()) as { value?: unknown };
    if (!isParallelChoice(body.value)) return NextResponse.json({ error: `value must be one of ${PARALLEL_CHOICES.join(", ")}` }, { status: 400 });
    const db = getDb();
    setAttendedParallel(db, body.value);
    return NextResponse.json({ value: attendedParallel(db) });
  } catch (e) {
    return failResponse(e);
  }
});
