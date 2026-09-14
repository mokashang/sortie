import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { deleteDocument, listDocuments, saveDocument, userDocumentsDir, DOCUMENT_MAX_BYTES } from "@/lib/documents";
import { withUser, failResponse } from "@/lib/actor";

// Standing documents (transcript, portfolio, ...) the apply executor can upload into forms —
// see src/lib/documents.ts. Each account has its own folder. Used by /profile's 文件 tab and by
// a 待处理 card's file item.
//   GET            -> { documents: DocumentRow[] }
//   POST multipart -> fields `key` (a-z0-9_) + `file`; replaces any file already stored under key
//   DELETE ?key=   -> { ok, removed }

export const GET = withUser(async (_req, { userId }) => {
  try {
    return NextResponse.json({ documents: listDocuments(userDocumentsDir(getDb(), userId)) });
  } catch (e) {
    return failResponse(e);
  }
});

export const POST = withUser(async (req, { userId }) => {
  try {
    const form = await req.formData();
    const key = String(form.get("key") ?? "").trim();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
    if (file.size > DOCUMENT_MAX_BYTES) return NextResponse.json({ error: "file larger than 15 MB" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const row = saveDocument(key, file.name, bytes, userDocumentsDir(getDb(), userId));
    return NextResponse.json({ ok: true, document: row });
  } catch (e) {
    return failResponse(e);
  }
});

export const DELETE = withUser(async (req, { userId }) => {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  try {
    return NextResponse.json({ ok: true, removed: deleteDocument(key.trim(), userDocumentsDir(getDb(), userId)) });
  } catch (e) {
    return failResponse(e);
  }
});
