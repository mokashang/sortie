import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { IngestBodySchema, ingestJobs } from "@/scanner/ingest";
import { startPostScanPipeline } from "@/scanner/relay";
import { withUser } from "@/lib/actor";

// POST /api/scan/ingest {runId?, jobs:[{company,title,location,jdText,applyUrl,source:'linkedin'|'handshake'|'tesla',postedAt?,jobKind?}]}
// — Chrome 扫描 run 每 10 条调一次;≤200 条/次。有新增就接力(去重 → 打分 → …)。岗位入公共库。
export const POST = withUser(async (req) => {
  const parsed = IngestBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const db = getDb();
  const s = ingestJobs(db, parsed.data.jobs);
  if (s.inserted > 0) startPostScanPipeline(db);
  return NextResponse.json(s);
});
