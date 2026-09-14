import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { queueByDirection } from "@/apply/queue";
import { withUser } from "@/lib/actor";

// GET /api/queue/by-direction — per-direction summary of the matched (non-parked) apply queue.
// Feeds /queue's direction-grouped panels and /apply's per-direction quota table.
export const GET = withUser(async (_req, { userId }) => {
  const groups = queueByDirection(getDb(), userId);
  return NextResponse.json({ groups });
});
