import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getBackend } from "@/llm/registry";
import { extractPdfText } from "@/resume/pdf-text";
import { importResume } from "@/resume/import";
import { uploadedResumePath } from "@/apply/resume-select";
import { withUser, failResponse } from "@/lib/actor";
import { langFromRequest, messagesFor } from "@/i18n/server";

// POST — 档案 → 经历 → 从简历导入: read the resume this account uploaded (档案 → 简历) and add its
// entries to the experience bank (src/resume/import.ts). → {created, skipped, filled}.
export const POST = withUser(async (req, { userId, user }) => {
  const t = messagesFor(langFromRequest(req)).errors;
  try {
    const db = getDb();
    const file = uploadedResumePath(db, userId);
    if (!file) return NextResponse.json({ error: t.noResume, code: "no_resume" }, { status: 400 });
    if (!file.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: t.importPdfOnly, code: "pdf_only" }, { status: 400 });
    const text = await extractPdfText(file);
    if (!text || !text.trim()) return NextResponse.json({ error: t.importNoText, code: "no_text" }, { status: 400 });
    const result = await importResume(db, userId, text, getBackend(), { name: user?.name, email: user?.email });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return failResponse(e, 500);
  }
});
