import Link from "next/link";
import { directionLabel } from "@/matcher/directions";
import type { TodaySubmittedRow } from "@/apply/history";
import { Chip, EmptyState } from "@/app/components/ui";

// 今日已提交 (local calendar day): a compact list; the full record lives on 历史.
export function TodaySubmitted({ rows }: { rows: TodaySubmittedRow[] }) {
  if (rows.length === 0) {
    return <EmptyState compact title="今天还没有提交" description="确认后由助手提交的申请会记在这里,本地 0 点重置。" />;
  }
  return (
    <div>
      <div className="submitted-list">
        {rows.map((r) => (
          <div key={r.jobId} className="submitted-row">
            <span className="mono muted small">{r.submittedAt}</span>
            <span className="serif strong">{r.company}</span>
            <span className="grow truncate">{r.title}</span>
            <Chip outline>{r.direction ? directionLabel(r.direction) : "未分类"}</Chip>
            {r.applyMode === "referral" ? <Chip tone="good">内推{r.referralPersonName ? ` · ${r.referralPersonName}` : ""}</Chip> : <Chip>海投</Chip>}
          </div>
        ))}
      </div>
      <p className="muted small mt-3">
        完整记录和后续状态见 <Link href="/history">历史</Link>。
      </p>
    </div>
  );
}
