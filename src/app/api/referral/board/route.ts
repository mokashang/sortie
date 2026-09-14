import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { referralBoard } from "@/apply/referral";
import { withUser } from "@/lib/actor";

// GET — /apply's 内推进行中 board: one card per company with in-flight referral jobs.
export const GET = withUser(async (_req, { userId }) => {
  return NextResponse.json({ cards: referralBoard(getDb(), userId) });
});
