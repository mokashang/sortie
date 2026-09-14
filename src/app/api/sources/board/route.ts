import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { setBoardTier, TIERS } from "@/scanner/boards";
import { withUser, requireOwner, failResponse } from "@/lib/actor";

const Body = z.object({ key: z.string().min(3), tier: z.enum(TIERS as [string, ...string[]]) });

// PATCH /api/sources/board {key, tier} — 用户手动改层级(含静音/恢复);写 tier_locked=1,自动升降不再碰它。
// 信息源是全机共享的,只有主账号能改。
export const PATCH = withUser(async (req, actor) => {
  try {
    requireOwner(actor);
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    setBoardTier(getDb(), parsed.data.key, parsed.data.tier as (typeof TIERS)[number]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return failResponse(e, 404);
  }
});
