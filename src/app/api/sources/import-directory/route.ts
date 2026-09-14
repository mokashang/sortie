import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DIRECTORY_URL, DirectoryEntry, importDirectory } from "@/scanner/sources/directory";
import { withUser, requireOwner, failResponse } from "@/lib/actor";

// POST /api/sources/import-directory — 一次性导入开源公司目录(4700+ 家)为 longtail;再点只补新增。主账号专用。
export const POST = withUser(async (_req, actor) => {
  try {
    requireOwner(actor);
    const res = await fetch(DIRECTORY_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return NextResponse.json({ error: `directory: HTTP ${res.status}` }, { status: 502 });
    const raw = (await res.json()) as DirectoryEntry[] | Record<string, DirectoryEntry>;
    const entries = Array.isArray(raw) ? raw : Object.values(raw);
    const r = importDirectory(getDb(), entries, { now: new Date() });
    return NextResponse.json({ ...r, entries: entries.length });
  } catch (e) {
    return failResponse(e, 500);
  }
});
