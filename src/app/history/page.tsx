import { getDb } from "@/lib/db";
import { applicationHistory } from "@/apply/history";
import { PageHeader } from "@/app/components/ui";
import { HistoryClient } from "./history-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "历史" };

// 历史: every application that was actually submitted, grouped by direction and by day, with a
// per-row status you update by hand as OA / interview / offer news comes in.
export default function HistoryPage() {
  const rows = applicationHistory(getDb());
  return (
    <>
      <PageHeader title="历史" kicker={`已提交 ${rows.length} 份`} />
      <HistoryClient rows={rows} />
    </>
  );
}
