import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { applicationHistory } from "@/apply/history";
import { PageHeader } from "@/app/components/ui";
import { getMessages } from "@/i18n/server";
import { HistoryClient } from "./history-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.history };
}

// 历史: every application that was actually submitted, grouped by direction and by day, with a
// per-row status you update by hand as OA / interview / offer news comes in.
export default async function HistoryPage() {
  const user = await requireUser("/history");
  const m = await getMessages();
  const rows = applicationHistory(getDb(), user.id);
  return (
    <>
      <PageHeader title={m.nav.history} kicker={m.history.submittedCount(rows.length)} />
      <HistoryClient rows={rows} />
    </>
  );
}
