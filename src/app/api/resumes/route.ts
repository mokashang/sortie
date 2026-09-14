import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withUser } from "@/lib/actor";

export const GET = withUser(async (_req, { userId }) => {
  const rows = getDb()
    .prepare("SELECT id, version_name, directions, pdf_path, compiled_at FROM resumes WHERE user_id = ? ORDER BY compiled_at DESC")
    .all(userId);
  return NextResponse.json({ resumes: rows });
});
