import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { nextJdReviewBatch } from "@/jd-review/service";
import { withUser, requireOwner } from "@/lib/actor";

// Executor(jd_review) -> App: "give me up to N jobs whose JD is still missing", queue order.
// JDs are shared facts: one read serves every account, and only the owner's run does the reading.
export const GET = withUser(async (req, actor) => {
  requireOwner(actor);
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? "40") || 40;
  return NextResponse.json({ jobs: nextJdReviewBatch(getDb(), limit) });
});
