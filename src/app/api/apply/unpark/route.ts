import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { unpark } from "@/apply/queue";
import { maybeAutoStartApply } from "@/apply/decide-auto-start";

// User -> App from a 待处理 card's 「让助手再试一次 / 让助手重新来」: clear the paused
// application's reason and to-do items so it re-enters the executor's pool, and re-queue it as a
// targeted run right away (nothing spawns if a run is already live or queued — that run, or the
// next one, takes it).
export async function POST(req: Request) {
  const body = await req.json();
  try {
    const db = getDb();
    const jobId = Number(body.jobId);
    unpark(db, jobId);
    const started = maybeAutoStartApply(db, { jobIds: [jobId], mode: "direct" });
    return NextResponse.json({ ok: true, ...started });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
