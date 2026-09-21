import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withInternal } from "@/lib/actor";
import { syncAllMailboxes } from "@/inbox/sync";

// Called every 15 minutes by src/instrumentation.ts: one sync per connected mailbox that is due.
export const POST = withInternal(async () => {
  if (process.env.INBOX_SYNC_DISABLED) return NextResponse.json({ disabled: true });
  const results = await syncAllMailboxes(getDb(), { dueOnly: true });
  return NextResponse.json({ synced: results.length, results });
});
