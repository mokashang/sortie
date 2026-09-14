import { getDb } from "@/lib/db";
import { resolveResumePath } from "@/lib/paths";
import fs from "fs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().prepare("SELECT pdf_path FROM resumes WHERE id=?").get(Number(id)) as { pdf_path: string | null } | undefined;
  // The stored path may come from another machine (the Mac-era rows): resolve it before looking.
  const file = row ? resolveResumePath(row.pdf_path) : "";
  if (!file || !fs.existsSync(file)) return new Response("not found", { status: 404 });
  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf" } });
}
