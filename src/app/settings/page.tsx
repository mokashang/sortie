import { getDb } from "@/lib/db";
import { sourcesSummary } from "@/scanner/sources-view";
import { PageHeader } from "@/app/components/ui";
import { SettingsClient, type LastTick } from "./settings-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "设置" };

export default function SettingsPage() {
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
      <PageHeader title="设置" />
      <SettingsClient ntfyConfigured={Boolean(process.env.NTFY_TOPIC)} lastTick={lastTick} />
    </>
  );
}
