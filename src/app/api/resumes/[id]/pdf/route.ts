import { getDb } from "@/lib/db";
import fs from "fs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare("SELECT pdf_path FROM resumes WHERE id=?").get(Number(id)) as { pdf_path: string } | undefined;
  if (!row || !row.pdf_path || !fs.existsSync(row.pdf_path)) return new Response("not found", { status: 404 });
  const buf = fs.readFileSync(row.pdf_path);
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf" } });
}
