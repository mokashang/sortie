import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const rows = getDb()
    .prepare("SELECT id, version_name, directions, pdf_path, compiled_at FROM resumes ORDER BY compiled_at DESC")
    .all();
  return NextResponse.json({ resumes: rows });
}
