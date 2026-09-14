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

// The four inboxes of 投递 in one row of tabs, like the 档案 page: one panel shows at a time and
// every tab keeps its count. All four panels stay mounted (hidden, not unmounted) so switching is
// instant, a half-typed answer survives a look at another tab, and each list polls as before.
// The chosen tab is written to ?tab= (replaceState, like 档案), so a reload or a link lands on it.
export function ApplyTabs({ tab: initialTab, counts: initialCounts, submitted }: { tab: ApplyTab; counts: ApplyTabCounts; submitted: React.ReactNode }) {
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

  const labels: Record<ApplyTab, string> = {
    todo: m.apply.todo.sectionTitle,
    confirm: m.apply.confirm.sectionTitle,
    referrals: m.apply.referrals.sectionTitle,
    submitted: m.apply.submitted.sectionTitle,
  };
  const panels: Record<ApplyTab, React.ReactNode> = {
    todo: <InfoCards />,
    confirm: <ConfirmCards />,
    referrals: <ReferralBoard />,
    submitted,
  };

  return (
    <section className="section">
      <Tabs ariaLabel={m.apply.title} value={tab} onChange={select} items={APPLY_TABS.map((t) => ({ key: t, label: labels[t], count: counts[t] }))} />
      {APPLY_TABS.map((t) => (
        <div key={t} role="tabpanel" hidden={t !== tab}>
          {panels[t]}
        </div>
      ))}
    </section>
  );
}
