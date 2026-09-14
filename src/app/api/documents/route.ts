import { NextResponse } from "next/server";
import { deleteDocument, listDocuments, saveDocument, DOCUMENT_MAX_BYTES } from "@/lib/documents";

// Standing documents (transcript, portfolio, ...) the apply executor can upload into forms —
// see src/lib/documents.ts. Used by /profile's 文件 tab and by a 待处理 card's file item.
//   GET            -> { documents: DocumentRow[] }
//   POST multipart -> fields `key` (a-z0-9_) + `file`; replaces any file already stored under key
//   DELETE ?key=   -> { ok, removed }

export async function GET() {
  try {
    return NextResponse.json({ documents: listDocuments() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const key = String(form.get("key") ?? "").trim();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
    if (file.size > DOCUMENT_MAX_BYTES) return NextResponse.json({ error: "file larger than 15 MB" }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const row = saveDocument(key, file.name, bytes);
    return NextResponse.json({ ok: true, document: row });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  try {
    return NextResponse.json({ ok: true, removed: deleteDocument(key.trim()) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
