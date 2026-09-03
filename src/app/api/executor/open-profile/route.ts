import { NextResponse } from "next/server";
import { openBrowserProfile } from "@/executor/open-profile";

// POST — spawns a headed Chrome window on the persistent browser-profile dir (data/browser-
// profile) that the headless executor's Playwright MCP drives, so the user can log into
// LinkedIn/Workday/etc. once. Detached: this route returns as soon as the process is spawned, it
// does not wait for the Chrome window to close. See src/executor/open-profile.ts for the actual
// spawn logic (unit-tested there with an injected spawn — no real Chrome in tests).
export async function POST() {
  try {
    const result = openBrowserProfile();
    return NextResponse.json({ ok: true, pid: result.pid });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
