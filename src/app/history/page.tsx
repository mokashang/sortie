import { getDb } from "@/lib/db";
import { applicationHistory } from "@/apply/history";
import { HistoryBoard } from "./history-board";

export const dynamic = "force-dynamic";

// 投递历史: every application that was actually submitted, grouped by direction tab and by
// submission day, with a per-row status selector the user updates by hand as OA/interview/offer
// news comes in. Pre-submit work (待确认, 需人工) stays on /apply.
export default function HistoryPage() {
  const rows = applicationHistory(getDb());
  return (
    <div>
      <h1>
        投递历史 <small>(共 {rows.length} 份)</small>
      </h1>
      <p className="panel-sub">
        已提交的申请按方向分 tab、按投递日期分组。状态由你手动更新(OA / 面试 / Offer / 被拒 / 无回音),每次变更都会记一条时间线。
      </p>
      <HistoryBoard rows={rows} />
    </div>
  );
}
