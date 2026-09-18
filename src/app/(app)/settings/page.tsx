import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { authPublicConfig } from "@/lib/auth";
import { sourcesSummary } from "@/scanner/sources-view";
import { PageHeader } from "@/app/components/ui";
import { getMessages } from "@/i18n/server";
import { SettingsClient, type LastTick } from "./settings-client";
import { getAiProvider, providerStatuses } from "@/ai/config";
import { getAutoSubmit } from "@/apply/auto-submit";
import { getChatProvider } from "@/assistant/provider";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.settings };
}

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  const m = await getMessages();
  let lastTick: LastTick | null = null;
  try {
    const t = sourcesSummary(getDb()).lastTick;
    if (t) {
      const p = (t.payload ?? {}) as { boards?: number; inserted?: number; errors?: unknown[] };
      lastTick = { at: t.at, boards: p.boards ?? 0, inserted: p.inserted ?? 0, errors: Array.isArray(p.errors) ? p.errors.length : 0 };
    }
  } catch {
    lastTick = null;
  }
  const auth = authPublicConfig();
  return (
    <>
      <PageHeader title={m.settings.title} />
      <SettingsClient
        ntfyConfigured={Boolean(process.env.NTFY_TOPIC)}
        lastTick={lastTick}
        account={{ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, role: user.role }}
        auth={auth}
        ai={{ provider: getAiProvider(getDb()), providers: providerStatuses() }}
        autoSubmit={getAutoSubmit(getDb(), user.id)}
        chatProvider={getChatProvider(getDb(), user.id)}
      />
    </>
  );
}
