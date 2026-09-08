import { getDb } from "@/lib/db";
import { todaySubmitted } from "@/apply/history";
import { PageHeader, Section } from "@/app/components/ui";
import { AssistantCard } from "@/app/components/assistant-card";
import { PlanCard } from "./plan-card";
import { InfoCards } from "./info-cards";
import { ConfirmCards } from "./confirm-cards";
import { ReferralBoard } from "./referral-board";
import { ManualList, type ManualRow } from "./manual-list";
import { TodaySubmitted } from "./today-submitted";

export const dynamic = "force-dynamic";
export const metadata = { title: "投递" };

// 投递: plan a run, watch the assistant, and decide on everything it hands back — confirmations,
// missing answers, referral drafts — plus the parked (需人工) and submitted-today lists.
export default function ApplyPage() {
  const db = getDb();

  const manualRows = db
    .prepare(
      `SELECT a.job_id, j.company, j.title, j.apply_url, a.needs_manual_reason, m.direction,
              strftime('%m-%d %H:%M', a.updated_at, 'localtime') as updated_at
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN matches m ON m.job_id = j.id
       WHERE a.status = 'matched' AND a.needs_manual_reason IS NOT NULL AND a.pending_questions IS NULL
       ORDER BY a.updated_at DESC
       LIMIT 200`
    )
    .all() as ManualRow[];

  const submittedRows = todaySubmitted(db);

  return (
    <>
      <PageHeader title="投递" subtitle="选好每个方向的份数,助手在你的 Chrome 里找人或填表;任何提交和发送都先经你确认。" />
      <AssistantCard />
      <PlanCard />
      <InfoCards />
      <Section id="confirm" title="待确认" description="助手填好、停在提交前一步的申请。核对后点确认,它才会点提交。">
        <ConfirmCards />
      </Section>
      <Section id="referrals" title="内推进行中" description="助手找到的联系人和草稿。你批准的消息才会发出;拿到内推后点「有内推了」。">
        <ReferralBoard />
      </Section>
      <Section id="manual" title="需人工" count={manualRows.length} description="助手处理不了的申请:登录墙、验证码、死链等。可以自己投,或重试、移除。">
        <ManualList rows={manualRows} />
      </Section>
      <Section id="submitted" title="今日已提交" count={submittedRows.length}>
        <TodaySubmitted rows={submittedRows} />
      </Section>
    </>
  );
}
