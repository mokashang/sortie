import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { authPublicConfig } from "@/lib/auth";
import { sourcesSummary } from "@/scanner/sources-view";
import { PageHeader } from "@/app/components/ui";
import { SettingsClient, type LastTick } from "./settings-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "设置" };

export default async function SettingsPage() {
  const user = await requireUser("/settings");
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
      <PageHeader title="设置" />
      <SettingsClient
        ntfyConfigured={Boolean(process.env.NTFY_TOPIC)}
        lastTick={lastTick}
        account={{ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, role: user.role }}
        auth={auth}
      />
    </>
  );
}
