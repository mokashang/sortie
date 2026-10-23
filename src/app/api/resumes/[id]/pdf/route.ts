import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { resolveResumePath, dataDir } from "@/lib/paths";
import { withUser } from "@/lib/actor";

// Only a PDF inside the data directory is ever served, whatever the row says: rows are written by
// generateResume today, but this route reads a file off disk by a stored path, so it checks.
function servable(file: string): boolean {
  if (!file || path.extname(file).toLowerCase() !== ".pdf") return false;
  const rel = path.relative(path.resolve(dataDir()), path.resolve(file));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export const GET = withUser(async (_req, { userId }, { params }) => {
  const { id } = await params;
  const row = getDb().prepare("SELECT pdf_path, version_name FROM resumes WHERE user_id = ? AND id = ?").get(userId, Number(id)) as
    | { pdf_path: string | null; version_name: string | null }
    | undefined;
  // The stored path may come from another machine (the Mac-era rows): resolve it before looking.
  const file = row ? resolveResumePath(row.pdf_path) : "";
  if (!servable(file) || !fs.existsSync(file)) return new Response("not found", { status: 404 });
  const buf = fs.readFileSync(file);
  const name = `${(row?.version_name ?? "resume").replace(/[^\w.-]+/g, "_")}.pdf`;
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"`, "cache-control": "private, no-store" },
  });
});
