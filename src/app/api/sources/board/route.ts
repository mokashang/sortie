import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { setBoardTier, TIERS } from "@/scanner/boards";

const Body = z.object({ key: z.string().min(3), tier: z.enum(TIERS as [string, ...string[]]) });

// PATCH /api/sources/board {key, tier} — 用户手动改层级(含静音/恢复);写 tier_locked=1,自动升降不再碰它。
export async function PATCH(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    setBoardTier(getDb(), parsed.data.key, parsed.data.tier as (typeof TIERS)[number]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 404 });
  }
}
