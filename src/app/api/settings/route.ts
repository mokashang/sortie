import { NextResponse } from "next/server";
import { authPublicConfig } from "@/lib/auth";
import { failResponse, requireOwner, withUser } from "@/lib/actor";
import { getDb } from "@/lib/db";
import { getAiProvider, parseAiProvider, providerStatuses, setAiProvider } from "@/ai/config";

// GET — read-only facts the 设置 page shows (nothing secret: whether phone push and mail are
// configured, whether Google sign-in is available, who is signed in).
export const GET = withUser(async (_req, { user, via }) => {
  const db = getDb();
  return NextResponse.json({
    ntfyConfigured: Boolean(process.env.NTFY_TOPIC),
    ...authPublicConfig(),
    user: user ? { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, role: user.role } : null,
    via,
    ai: { provider: getAiProvider(db), providers: providerStatuses() },
  });
});

export const POST = withUser(async (req, actor) => {
  try {
    requireOwner(actor);
    const body = (await req.json()) as { provider?: unknown };
    const provider = parseAiProvider(body.provider);
    if (!provider) return NextResponse.json({ error: "provider must be claude, codex, or gpt" }, { status: 400 });
    const status = providerStatuses().find((item) => item.provider === provider);
    if (!status?.configured) {
      return NextResponse.json({ error: status?.reason ?? `${provider} is not configured`, code: "provider_not_configured" }, { status: 409 });
    }
    const db = getDb();
    setAiProvider(db, provider);
    return NextResponse.json({ provider, providers: providerStatuses() });
  } catch (e) {
    return failResponse(e);
  }
});
