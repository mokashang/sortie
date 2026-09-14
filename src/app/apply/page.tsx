import { getDb } from "@/lib/db";
import { todaySubmitted } from "@/apply/history";
import { PageHeader, Section } from "@/app/components/ui";
import { AssistantCard } from "@/app/components/assistant-card";
import { PlanCard } from "./plan-card";
import { InfoCards } from "./info-cards";
import { ConfirmCards } from "./confirm-cards";
import { ReferralBoard } from "./referral-board";
import { TodaySubmitted } from "./today-submitted";

export const dynamic = "force-dynamic";
export const metadata = { title: "投递" };

// 投递: plan a run, watch the assistant, and decide on everything it hands back — the 待处理
// cards (missing answers / files, a site to log into once, something to finish by hand),
// confirmations, referral drafts — plus the submitted-today list. There is no parking lot:
// every card ends in an action after which the assistant continues by itself.
export default function ApplyPage() {
  const db = getDb();
  const submittedRows = todaySubmitted(db);

  return (
    <>
      <PageHeader title="投递" subtitle="任何提交和发送都先经你确认。" />
      <AssistantCard />
      <PlanCard />
      <InfoCards />
      <Section id="confirm" title="待确认" description="助手填好、停在提交前一步的申请。核对后点确认,它才会点提交。">
        <ConfirmCards />
      </Section>
      <Section id="referrals" title="内推进行中" description="助手找到的联系人和草稿。你批准的消息才会发出;拿到内推后点「有内推了」。">
        <ReferralBoard />
      </Section>
      <Section id="submitted" title="今日已提交" count={submittedRows.length}>
        <TodaySubmitted rows={submittedRows} />
      </Section>
    </>
  );
}
