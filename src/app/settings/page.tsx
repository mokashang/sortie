import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { sourcesSummary } from "@/scanner/sources-view";
import { PageHeader } from "@/app/components/ui";
import { getMessages } from "@/i18n/server";
import { SettingsClient, type LastTick } from "./settings-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.settings };
}

export default async function SettingsPage() {
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
  return (
    <>
      <PageHeader title={m.settings.title} />
      <SettingsClient ntfyConfigured={Boolean(process.env.NTFY_TOPIC)} lastTick={lastTick} />
    </>
  );
}
