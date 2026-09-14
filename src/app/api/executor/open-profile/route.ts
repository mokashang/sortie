import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { openBrowserProfile } from "@/executor/open-profile";
import { browserProfileDir } from "@/executor/mcp-config";
import { ownerId } from "@/lib/users";
import { withUser, failResponse } from "@/lib/actor";

// POST — spawns a headed Chrome window on the account's persistent browser-profile dir (the
// owner keeps data/browser-profile, others get data/users/<id>/browser-profile) that the headless
// executor's Playwright MCP drives, so the user can log into LinkedIn/Workday/etc. once. Detached:
// this route returns as soon as the process is spawned, it does not wait for the Chrome window to
// close. See src/executor/open-profile.ts for the actual spawn logic.
export const POST = withUser(async (_req, { userId }) => {
  try {
    const profileDir = browserProfileDir(process.cwd(), ownerId(getDb()) === userId ? null : userId);
    const result = openBrowserProfile({ profileDir });
    return NextResponse.json({ ok: true, pid: result.pid });
  } catch (e) {
    return failResponse(e);
  }
});
