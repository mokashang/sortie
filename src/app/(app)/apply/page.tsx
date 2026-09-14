import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { overview } from "@/apply/overview";
import { todaySubmitted } from "@/apply/history";
import { PageHeader } from "@/app/components/ui";
import { AssistantCard } from "@/app/components/assistant-card";
import { applyTabCounts, defaultApplyTab, isApplyTab } from "@/app/lib/apply-tabs";
import { getMessages } from "@/i18n/server";
import { PlanCard } from "./plan-card";
import { ApplyTabs } from "./apply-tabs";
import { TodaySubmitted } from "./today-submitted";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.apply };
}

// 投递: plan a run, watch the assistant, then decide on everything it hands back, in four tabs —
// 待处理 (missing answers / files, a site to log into once, something to finish by hand), 待确认,
// 内推进行中 and 今日已提交. There is no parking lot: every card ends in an action after which the
// assistant continues by itself. ?tab= picks the tab; without it the first non-empty inbox opens.
export default async function ApplyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("/apply");
  const m = await getMessages();
  const sp = await searchParams;
  const db = getDb();
  const counts = applyTabCounts(overview(db, user.id).counts);
  const tab = isApplyTab(sp.tab) ? sp.tab : defaultApplyTab(counts);
  const submittedRows = todaySubmitted(db, user.id);

  return (
    <>
      <PageHeader title={m.apply.title} subtitle={m.apply.subtitle} />
      <AssistantCard />
      <PlanCard />
      <ApplyTabs tab={tab} counts={counts} submitted={<TodaySubmitted rows={submittedRows} />} />
    </>
  );
}
