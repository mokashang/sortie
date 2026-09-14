import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { todaySubmitted } from "@/apply/history";
import { PageHeader, Section } from "@/app/components/ui";
import { AssistantCard } from "@/app/components/assistant-card";
import { getMessages } from "@/i18n/server";
import { PlanCard } from "./plan-card";
import { InfoCards } from "./info-cards";
import { ConfirmCards } from "./confirm-cards";
import { ReferralBoard } from "./referral-board";
import { ManualList, type ManualRow } from "./manual-list";
import { TodaySubmitted } from "./today-submitted";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.apply };
}

// 投递: plan a run, watch the assistant, and decide on everything it hands back — confirmations,
// missing answers, referral drafts — plus the parked (需人工) and submitted-today lists.
export default async function ApplyPage() {
  const m = await getMessages();
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
      <PageHeader title={m.apply.title} subtitle={m.apply.subtitle} />
      <AssistantCard />
      <PlanCard />
      <InfoCards />
      <Section id="confirm" title={m.apply.confirm.sectionTitle} description={m.apply.confirm.sectionDescription}>
        <ConfirmCards />
      </Section>
      <Section id="referrals" title={m.apply.referrals.sectionTitle} description={m.apply.referrals.sectionDescription}>
        <ReferralBoard />
      </Section>
      <Section id="manual" title={m.apply.manual.sectionTitle} count={manualRows.length} description={m.apply.manual.sectionDescription}>
        <ManualList rows={manualRows} />
      </Section>
      <Section id="submitted" title={m.apply.submitted.sectionTitle} count={submittedRows.length}>
        <TodaySubmitted rows={submittedRows} />
      </Section>
    </>
  );
}
