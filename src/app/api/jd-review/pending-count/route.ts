import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingJdReviewCount } from "@/jd-review/service";
import { withUser } from "@/lib/actor";

export const GET = withUser(async () => {
  return NextResponse.json({ pending: pendingJdReviewCount(getDb()) });
});
