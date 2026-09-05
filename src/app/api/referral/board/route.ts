import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { referralBoard } from "@/apply/referral";

// GET — /apply's 内推进行中 board: one card per company with in-flight referral jobs.
export async function GET() {
  return NextResponse.json({ cards: referralBoard(getDb()) });
}
