import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { overview } from "@/apply/overview";
import { withUser } from "@/lib/actor";

// GET — badge counts + in-flight assistant task for the app shell and the 今日 page (polled every 5s).
export const GET = withUser(async (_req, { userId }) => {
  try {
    return NextResponse.json(overview(getDb(), userId));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
});
