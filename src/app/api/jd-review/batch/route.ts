import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { nextJdReviewBatch } from "@/jd-review/service";
import { withUser } from "@/lib/actor";

// Executor(jd_review) -> App: "give me up to N jobs whose JD is still missing", queue order.
// JDs are shared facts, so any account's run may read for everyone.
export const GET = withUser(async (req) => {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? "40") || 40;
  return NextResponse.json({ jobs: nextJdReviewBatch(getDb(), limit) });
});
