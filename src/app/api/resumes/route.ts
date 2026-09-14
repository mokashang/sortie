import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resolveResumePath } from "@/lib/paths";

interface ResumeListRow {
  id: number;
  version_name: string;
  directions: string;
  pdf_path: string | null;
  compiled_at: string | null;
}

export async function GET() {
  const rows = getDb()
    .prepare("SELECT id, version_name, directions, pdf_path, compiled_at FROM resumes ORDER BY compiled_at DESC")
    .all() as ResumeListRow[];
  // pdf_path goes out as a path valid on THIS machine, not the string the row happens to store.
  return NextResponse.json({ resumes: rows.map((r) => ({ ...r, pdf_path: resolveResumePath(r.pdf_path) })) });
}
