import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { sourcesSummary, pagedBoards, recentBoardEvents } from "@/scanner/sources-view";
import { TIERS, Tier } from "@/scanner/boards";
import { FAMILIES } from "@/scanner/board-key";
import { withUser } from "@/lib/actor";

// GET /api/sources?family=&tier=&q=&page= — 来源页数据:按 family 汇总 + 板块分页 + 最近升降级事件。
export const GET = withUser(async (req) => {
  const url = new URL(req.url);
  const family = url.searchParams.get("family") ?? undefined;
  const tierParam = url.searchParams.get("tier") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const db = getDb();
  const summary = sourcesSummary(db);
  const boards = pagedBoards(db, {
    family: family && (FAMILIES as string[]).includes(family) ? family : undefined,
    tier: tierParam && (TIERS as string[]).includes(tierParam) ? (tierParam as Tier) : undefined,
    q: q || undefined,
    page,
    pageSize: 50,
  });
  return NextResponse.json({ ...summary, ...boards, events: recentBoardEvents(db) });
});
