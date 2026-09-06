import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { overview } from "@/apply/overview";

// GET — badge counts + in-flight assistant task for the app shell and the 今日 page (polled every 5s).
export async function GET() {
  try {
    return NextResponse.json(overview(getDb()));
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
