import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { DIRECTORY_URL, DirectoryEntry, importDirectory } from "@/scanner/sources/directory";

// POST /api/sources/import-directory — 一次性导入开源公司目录(4700+ 家)为 longtail;再点只补新增。
export async function POST() {
  try {
    const res = await fetch(DIRECTORY_URL, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return NextResponse.json({ error: `directory: HTTP ${res.status}` }, { status: 502 });
    const raw = (await res.json()) as DirectoryEntry[] | Record<string, DirectoryEntry>;
    const entries = Array.isArray(raw) ? raw : Object.values(raw);
    const r = importDirectory(getDb(), entries, { now: new Date() });
    return NextResponse.json({ ...r, entries: entries.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
