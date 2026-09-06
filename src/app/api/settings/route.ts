import { NextResponse } from "next/server";

// GET — read-only facts the 设置 page shows (nothing secret: only whether phone push is configured).
export async function GET() {
  return NextResponse.json({ ntfyConfigured: Boolean(process.env.NTFY_TOPIC) });
}
