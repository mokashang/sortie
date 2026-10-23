import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getAutoSubmit, setAutoSubmit } from "@/apply/auto-submit";
import { withUser, failResponse, requireBrowser } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// 设置 → 自动投递: a per-account switch (src/apply/auto-submit.ts). Any signed-in account sets
// its own; the report route reads it on every report for that account.
export const GET = withUser(async (_req, { userId }) => {
  return NextResponse.json({ enabled: getAutoSubmit(getDb(), userId) });
});

export const POST = withUser(async (req, actor) => {
  requireBrowser(actor);
  const { userId } = actor;
  try {
    const body = (await readJsonBody(req)) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    const db = getDb();
    setAutoSubmit(db, userId, body.enabled);
    return NextResponse.json({ enabled: getAutoSubmit(db, userId) });
  } catch (e) {
    return failResponse(e);
  }
});
