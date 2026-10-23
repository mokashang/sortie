import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listLoginWalls } from "@/apply/info";
import { siteKey } from "@/apply/queue";
import { openUrlsInJobChrome } from "@/executor/open-profile";
import { withUser, failResponse, requireOwner } from "@/lib/actor";
import { readJsonBody } from "@/lib/request-body";

// 「全部去登录」 on the 待处理 tab: {hosts?:[…]} (default: every open wall). Opens each site's
// sign-in page as a tab of the job-search Chrome on this machine — the Chrome the assistant fills
// forms in — so the user just signs in (Chrome offers the saved / suggested credentials) and
// presses 「全部登好了」. The URLs come from this account's own login items, never from the request.
export const POST = withUser(async (req, actor) => {
  // The job-search Chrome on this machine is the owner's, signed in to the owner's accounts.
  requireOwner(actor);
  const { userId } = actor;
  const body = await readJsonBody(req, { allowEmpty: true });
  try {
    const walls = listLoginWalls(getDb(), userId);
    const wanted = Array.isArray(body.hosts) ? new Set((body.hosts as unknown[]).map((h) => siteKey(String(h ?? "")))) : null;
    const pick = wanted ? walls.filter((w) => wanted.has(siteKey(w.host))) : walls;
    if (pick.length === 0) return NextResponse.json({ ok: true, opened: 0, hosts: [] });
    openUrlsInJobChrome(pick.map((w) => w.url));
    return NextResponse.json({ ok: true, opened: pick.length, hosts: pick.map((w) => w.host) });
  } catch (e) {
    return failResponse(e);
  }
});
