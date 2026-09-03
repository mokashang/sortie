import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingJdReviewCount } from "@/jd-review/service";

export async function GET() {
  return NextResponse.json({ pending: pendingJdReviewCount(getDb()) });
}
