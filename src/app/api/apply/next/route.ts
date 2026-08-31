import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { loadProfile } from "@/lib/profile";
import { takeNextApplication } from "@/apply/queue";

// Executor -> App: "give me the next task". Thin wrapper over takeNextApplication; all the
// picking/locking/parking logic lives in src/apply/queue.ts so it can be unit-tested against
// :memory: without going through Next's request/response machinery.
export async function POST() {
  try {
    const result = takeNextApplication(getDb(), loadProfile());
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
