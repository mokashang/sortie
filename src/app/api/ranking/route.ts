import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { rankingBoard } from "@/apply/ranking";
import { withUser, failResponse } from "@/lib/actor";

// The 天梯 tab's data source (src/apply/ranking.ts): every company in rank order with what became of
// each job, the counts, and the task working the list.
export const GET = withUser(async (_req, { userId }) => {
  try {
    return NextResponse.json(rankingBoard(getDb(), userId));
  } catch (e) {
    return failResponse(e);
  }
});
