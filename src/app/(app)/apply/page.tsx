import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { todaySubmitted } from "@/apply/history";
import { PageHeader, Section } from "@/app/components/ui";
import { AssistantCard } from "@/app/components/assistant-card";
import { getMessages } from "@/i18n/server";
import { PlanCard } from "./plan-card";
import { InfoCards } from "./info-cards";
import { ConfirmCards } from "./confirm-cards";
import { ReferralBoard } from "./referral-board";
import { TodaySubmitted } from "./today-submitted";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.apply };
}

// 投递: plan a run, watch the assistant, and decide on everything it hands back — the 待处理
// cards (missing answers / files, a site to log into once, something to finish by hand),
// confirmations, referral drafts — plus the submitted-today list. There is no parking lot:
// every card ends in an action after which the assistant continues by itself.
export default async function ApplyPage() {
  const user = await requireUser("/apply");
  const m = await getMessages();
  const db = getDb();
  const submittedRows = todaySubmitted(db, user.id);

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
      <Section id="submitted" title={m.apply.submitted.sectionTitle} count={submittedRows.length}>
        <TodaySubmitted rows={submittedRows} />
      </Section>
    </>
  );
}
