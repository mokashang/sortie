import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createToken, listPersonalTokens, revokeToken } from "@/lib/api-tokens";
import { withUser, failResponse } from "@/lib/actor";

// 设置 → 账号 → 助手令牌 (spec 2026-09-13 accounts §2): personal bearer tokens for an attended
// session or script on the user's own machine. The plaintext is returned exactly once, on create.
export const GET = withUser(async (_req, { userId }) => {
  return NextResponse.json({ tokens: listPersonalTokens(getDb(), userId) });
});

export const POST = withUser(async (req, { userId, via }) => {
  try {
    // Minting a long-lived credential needs the person, not one of their tokens.
    if (via !== "session") return NextResponse.json({ error: "请在浏览器里登录后创建令牌" }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? "").trim() || "我的电脑";
    const { token, row } = createToken(getDb(), { userId, kind: "personal", name });
    return NextResponse.json({ token, row }, { status: 201 });
  } catch (e) {
    return failResponse(e);
  }
});

export const DELETE = withUser(async (req, { userId, via }) => {
  if (via !== "session") return NextResponse.json({ error: "请在浏览器里登录后撤销令牌" }, { status: 403 });
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const ok = revokeToken(getDb(), userId, id);
  return NextResponse.json({ ok });
});
