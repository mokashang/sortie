import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { startExecutor, ExecutorKind, ExecutorChannel } from "@/executor/runner";

const VALID_KINDS: ExecutorKind[] = ["apply", "network_send", "network_find"];
const VALID_CHANNELS: ExecutorChannel[] = ["headless", "user_chrome"];

// POST {kind: 'apply'|'network_send'|'network_find', options?, channel?: 'headless'|'user_chrome'}
// — starts an executor session for the requested kind. channel defaults to 'user_chrome' (the
// App's default: "值守会话" — an already-open interactive Claude Code session with the
// claude-in-chrome extension attached to the user's own Chrome polls claim-next and drives it).
// 'headless' spawns a detached `claude -p` process against its own Playwright browser profile, as
// before. Refuses (400) if one of the same kind+channel is already running/queued; see
// src/executor/runner.ts for the full duplicate-kind/PID-liveness/queued logic.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const kind = body.kind as string;
    if (!VALID_KINDS.includes(kind as ExecutorKind)) {
      return NextResponse.json({ error: `invalid kind '${kind}' (must be one of ${VALID_KINDS.join(", ")})` }, { status: 400 });
    }
    const channel = (body.channel as string) ?? "user_chrome";
    if (!VALID_CHANNELS.includes(channel as ExecutorChannel)) {
      return NextResponse.json(
        { error: `invalid channel '${channel}' (must be one of ${VALID_CHANNELS.join(", ")})` },
        { status: 400 }
      );
    }
    const result = startExecutor(getDb(), kind as ExecutorKind, body.options ?? {}, {}, channel as ExecutorChannel);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
