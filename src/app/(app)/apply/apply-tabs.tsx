"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { APPLY_TABS, applyTabCounts, isApplyTab, type ApplyTab, type ApplyTabCounts } from "@/app/lib/apply-tabs";
import { useMessages } from "@/i18n/client";
import { InfoCards } from "./info-cards";
import { ConfirmCards } from "./confirm-cards";
import { ReferralBoard } from "./referral-board";
import { RankingBoard } from "./ranking-board";

// The four inboxes of 投递 in one row of tabs, like the 档案 page: one panel shows at a time and
// every tab keeps its count. All four panels stay mounted (hidden, not unmounted) so switching is
// instant, a half-typed answer survives a look at another tab, and each list polls as before.
// The chosen tab is written to ?tab= (replaceState, like 档案), so a reload or a link lands on it.
export function ApplyTabs({ tab: initialTab, counts: initialCounts, hasRanking, submitted }: { tab: ApplyTab; counts: ApplyTabCounts; hasRanking: boolean; submitted: React.ReactNode }) {
  const m = useMessages();
  const { data } = useOverview();
  const sp = useSearchParams();
  const [tab, setTab] = useState<ApplyTab>(initialTab);
  const counts = data ? applyTabCounts(data.counts) : initialCounts;

  // A link into a specific tab while the page is already open (今日 → ?tab=referrals).
  const wanted = sp.get("tab");
  useEffect(() => {
    if (isApplyTab(wanted)) setTab(wanted);
  }, [wanted]);

  function select(key: string) {
    if (!isApplyTab(key)) return;
    setTab(key);
    window.history.replaceState(null, "", `/apply?tab=${key}`);
  }

  // From a row on the 天梯 tab to the card it is waiting on. The panels stay mounted, so the card is
  // already in the page once its tab shows.
  function goTo(key: "todo" | "confirm", jobId: number) {
    select(key);
    requestAnimationFrame(() => document.getElementById(`card-${jobId}`)?.scrollIntoView({ block: "center" }));
  }

  const labels: Record<ApplyTab, string> = {
    todo: m.apply.todo.sectionTitle,
    confirm: m.apply.confirm.sectionTitle,
    referrals: m.apply.referrals.sectionTitle,
    submitted: m.apply.submitted.sectionTitle,
    ranking: m.apply.ranking.sectionTitle,
  };
  const panels: Record<ApplyTab, React.ReactNode> = {
    todo: <InfoCards />,
    confirm: <ConfirmCards />,
    referrals: <ReferralBoard />,
    submitted,
    ranking: <RankingBoard active={tab === "ranking"} goTo={goTo} />,
  };

  // An account that can't look for referrals (no Chrome of its own on this server) gets no
  // 内推进行中 tab unless something is somehow on it.
  const shown = APPLY_TABS.filter((t) => (t === "ranking" ? hasRanking : t !== "referrals" || data?.chromeAvailable !== false || counts.referrals > 0));

  return (
    <section className="section">
      <Tabs ariaLabel={m.apply.title} value={tab} onChange={select} items={shown.map((t) => ({ key: t, label: labels[t], count: counts[t] }))} />
      {shown.map((t) => (
        <div key={t} role="tabpanel" hidden={t !== tab}>
          {panels[t]}
        </div>
      ))}
    </section>
  );
}
