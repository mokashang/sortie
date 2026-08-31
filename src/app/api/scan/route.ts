import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runScan } from "@/scanner/run";
import { syncWatchlist } from "@/scanner/watchlist";
import seed from "../../../../config/watchlist.seed.json";

export async function POST() {
  const db = getDb();
  syncWatchlist(db, seed);
  const summary = await runScan(db);
  return NextResponse.json(summary);
}
