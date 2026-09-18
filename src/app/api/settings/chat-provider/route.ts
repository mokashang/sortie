import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getChatProvider, parseChatProvider, setChatProvider } from "@/assistant/provider";
import { withUser, failResponse } from "@/lib/actor";

// 设置 → 问答助手: which model answers the in-app chat (src/assistant/provider.ts). Per account.
export const GET = withUser(async (_req, { userId }) => {
  return NextResponse.json({ provider: getChatProvider(getDb(), userId) });
});

export const POST = withUser(async (req, { userId }) => {
  try {
    const body = (await req.json()) as { provider?: unknown };
    const provider = parseChatProvider(body.provider);
    if (!provider) return NextResponse.json({ error: "provider must be claude or follow" }, { status: 400 });
    const db = getDb();
    setChatProvider(db, userId, provider);
    return NextResponse.json({ provider: getChatProvider(db, userId) });
  } catch (e) {
    return failResponse(e);
  }
});
