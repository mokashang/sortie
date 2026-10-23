import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pendingJdReviewCount } from "@/jd-review/service";
import { withUser } from "@/lib/actor";

// The count walks the whole jobs table (the eligibility columns sit behind each row's JD text):
// ~150 ms warm, 3.5 s right after a restart (2026-10-22), and every request behind it waits. The
// plan card fetches it on each mount for a "补正文 N" label, so a minute-old number is plenty.
const TTL_MS = 60_000;
let cached: { at: number; pending: number } | null = null;

export const GET = withUser(async () => {
  const now = Date.now();
  if (!cached || now - cached.at > TTL_MS) cached = { at: now, pending: pendingJdReviewCount(getDb()) };
  return NextResponse.json({ pending: cached.pending });
});
