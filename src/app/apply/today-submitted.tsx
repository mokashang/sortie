import Link from "next/link";
import type { TodaySubmittedRow } from "@/apply/history";
import { directionName } from "@/app/lib/labels";
import { Chip, EmptyState } from "@/app/components/ui";
import { getLang, messagesFor } from "@/i18n/server";

// 今日已提交 (local calendar day): a compact list; the full record lives on 历史. A server
// component (only page.tsx renders it), so the language comes from the request like the page's.
export async function TodaySubmitted({ rows }: { rows: TodaySubmittedRow[] }) {
  const lang = await getLang();
  const m = messagesFor(lang);
  if (rows.length === 0) {
    return <EmptyState compact title={m.apply.submitted.emptyTitle} description={m.apply.submitted.emptyDescription} />;
  }
  return (
    <div>
      <div className="submitted-list">
        {rows.map((r) => (
          <div key={r.jobId} className="submitted-row">
            <span className="mono muted small">{r.submittedAt}</span>
            <span className="serif strong">{r.company}</span>
            <span className="grow truncate">{r.title}</span>
            <Chip outline>{directionName(r.direction, lang)}</Chip>
            {r.applyMode === "referral" ? <Chip tone="good">{m.apply.submitted.referralChip(r.referralPersonName)}</Chip> : <Chip>{m.labels.mode.direct}</Chip>}
          </div>
        ))}
      </div>
      <p className="muted small mt-3">
        {m.apply.submitted.historyBefore}
        <Link href="/history">{m.nav.history}</Link>
        {m.apply.submitted.historyAfter}
      </p>
    </div>
  );
}
