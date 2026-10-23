import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isValidDocumentKey, listDocuments, userDocumentsDir } from "@/lib/documents";
import { withUser, failResponse } from "@/lib/actor";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".txt": "text/plain; charset=utf-8",
};

// GET ?key= — one of the account's own documents, to look at (档案 → 简历 previews the uploaded
// resume with it). Only files listDocuments() knows, from the caller's own folder.
export const GET = withUser(async (req, { userId }) => {
  try {
    const key = new URL(req.url).searchParams.get("key") ?? "";
    if (!isValidDocumentKey(key)) return NextResponse.json({ error: "invalid key" }, { status: 400 });
    const doc = listDocuments(userDocumentsDir(getDb(), userId)).find((d) => d.key === key);
    if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
    const ext = path.extname(doc.filename).toLowerCase();
    return new NextResponse(new Uint8Array(fs.readFileSync(doc.path)), {
      headers: {
        "content-type": TYPES[ext] ?? "application/octet-stream",
        "content-disposition": `inline; filename="${doc.filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    return failResponse(e);
  }
});
