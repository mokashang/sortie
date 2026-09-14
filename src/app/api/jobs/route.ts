import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withUser } from "@/lib/actor";

export const GET = withUser(async (req) => {
  const url = new URL(req.url);
  const includeVisaFlagged = url.searchParams.get("all") === "1";
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT id, company, title, location, source, job_kind, visa_flag, loc_flag, apply_url, posted_at, created_at
       FROM jobs ${includeVisaFlagged ? "" : "WHERE visa_flag IS NULL AND loc_flag IS NULL"}
       ORDER BY created_at DESC LIMIT 1000`
    )
    .all();
  return NextResponse.json({ jobs });
});
