import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { nextJdReviewBatch } from "@/jd-review/service";

// Executor(jd_review) -> App: "give me up to N jobs whose JD is still missing", queue order.
export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? "40") || 40;
  return NextResponse.json({ jobs: nextJdReviewBatch(getDb(), limit) });
}
