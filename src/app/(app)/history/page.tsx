import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { applicationHistory } from "@/apply/history";
import { PageHeader } from "@/app/components/ui";
import { HistoryClient } from "./history-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "历史" };

// 历史: every application that was actually submitted, grouped by direction and by day, with a
// per-row status you update by hand as OA / interview / offer news comes in.
export default async function HistoryPage() {
  const user = await requireUser("/history");
  const rows = applicationHistory(getDb(), user.id);
  return (
    <>
      <PageHeader title="历史" subtitle={`已提交 ${rows.length} 份。状态由你手动更新,每次变更都会留一条记录。`} />
      <HistoryClient rows={rows} />
    </>
  );
}
