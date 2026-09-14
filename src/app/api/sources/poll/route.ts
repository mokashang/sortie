import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { runSweep } from "@/scanner/scheduler";
import { startPostScanPipeline } from "@/scanner/relay";
import { withUser, requireOwner, failResponse } from "@/lib/actor";

const Body = z.object({ key: z.string().min(3) });

// POST /api/sources/poll {key} — 来源页「问一次」:立刻问这一个板块,有新增就接力。主账号专用。
export const POST = withUser(async (req, actor) => {
  try {
    requireOwner(actor);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    const db = getDb();
    const summary = await runSweep(db, { keys: [parsed.data.key], budgetBoards: 1, budgetMs: 5 * 60_000 });
    if (summary.inserted > 0) startPostScanPipeline(db);
    return NextResponse.json(summary);
  } catch (e) {
    return failResponse(e);
  }
});
