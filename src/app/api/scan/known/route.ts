import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { knownUrls } from "@/scanner/ingest";
import { withUser } from "@/lib/actor";

// GET /api/scan/known?urls=a,b  或  POST {urls:[…]} → {known:[…]}:值守会话用来跳过已入库的岗,不开详情页。
export const GET = withUser(async (req) => {
  const raw = new URL(req.url).searchParams.get("urls") ?? "";
  const urls = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 500);
  return NextResponse.json({ known: knownUrls(getDb(), urls) });
});
export const POST = withUser(async (req) => {
  const body = (await req.json().catch(() => ({}))) as { urls?: unknown };
  const urls = Array.isArray(body.urls) ? (body.urls as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 500) : [];
  return NextResponse.json({ known: knownUrls(getDb(), urls) });
});
