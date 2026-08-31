import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { startExecutor, ExecutorKind } from "@/executor/runner";

const VALID_KINDS: ExecutorKind[] = ["apply", "network_send", "network_find"];

// POST {kind: 'apply'|'network_send'|'network_find', options?} — launches a headless `claude -p`
// executor session for the requested kind. Refuses (400) if one of the same kind is already
// running; see src/executor/runner.ts for the full duplicate-kind/PID-liveness logic.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const kind = body.kind as string;
    if (!VALID_KINDS.includes(kind as ExecutorKind)) {
      return NextResponse.json({ error: `invalid kind '${kind}' (must be one of ${VALID_KINDS.join(", ")})` }, { status: 400 });
    }
    const result = startExecutor(getDb(), kind as ExecutorKind, body.options ?? {});
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
