import fs from "fs";
import { getDb } from "@/lib/db";
import { withUser } from "@/lib/actor";

export const GET = withUser(async (_req, { userId }, { params }) => {
  const { id } = await params;
  const row = getDb().prepare("SELECT pdf_path FROM resumes WHERE user_id = ? AND id = ?").get(userId, Number(id)) as { pdf_path: string } | undefined;
  if (!row || !row.pdf_path || !fs.existsSync(row.pdf_path)) return new Response("not found", { status: 404 });
  const buf = fs.readFileSync(row.pdf_path);
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf" } });
});
