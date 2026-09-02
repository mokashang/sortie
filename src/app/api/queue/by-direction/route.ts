import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { queueByDirection } from "@/apply/queue";

// GET /api/queue/by-direction — per-direction summary of the matched (non-parked) apply queue.
// Feeds /queue's direction-grouped panels and /apply's per-direction quota table.
export async function GET() {
  const groups = queueByDirection(getDb());
  return NextResponse.json({ groups });
}
