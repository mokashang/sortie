"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, Play } from "lucide-react";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { directionName, tierLabel } from "@/app/lib/labels";
import { buildPlan, clampCount, planTotals, type ApplyMode, type PlanCounts } from "@/app/lib/plan";
import { getChannel, type Channel } from "@/app/lib/settings";
import { Button, Card, Chip, EmptyState, Menu, SkeletonRows, Stepper, Tooltip, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { useLang, useMessages } from "@/i18n/client";

interface DirectionGroup {
  direction: string;
  tier: number | null;
  matched: number;
  referralSuggested: number;
  directSuggested: number;
}

// 本次投递计划: per-direction steppers for 找内推 / 海投 and one 开始投递. Sends
// { plan: [{direction, count, mode}] } to POST /api/executor/start on the channel chosen in 设置.
export function PlanCard() {
  const m = useMessages();
  const lang = useLang();
  const [groups, setGroups] = useState<DirectionGroup[] | null>(null);
  const [counts, setCounts] = useState<PlanCounts>({});
  const [starting, setStarting] = useState(false);
  const [channel, setChannel] = useState<Channel>("user_chrome");
  const [pendingJd, setPendingJd] = useState<number | null>(null);
  const { data, refresh: refreshOverview } = useOverview();
  const { toast } = useToast();
  const applyBusy = data?.liveKinds.includes("apply") ?? false;
  const jdBusy = data?.liveKinds.includes("jd_review") ?? false;

  useEffect(() => setChannel(getChannel()), []);

  const load = useCallback(async () => {
    try {
      const j = await getJson<{ groups: DirectionGroup[] }>("/api/queue/by-direction");
      const g = j.groups ?? [];
      setGroups(g);
      setCounts((prev) => {
        const next: PlanCounts = {};
        for (const row of g) next[row.direction] = prev[row.direction] ?? { referral: 0, direct: 0 };
        return next;
      });
    } catch (e) {
      toast({ title: m.apply.plan.loadFailed, description: errorMessage(e), tone: "danger" });
      setGroups([]);
    }
  }, [toast, m]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    getJson<{ pending: number }>("/api/jd-review/pending-count")
      .then((j) => setPendingJd(typeof j.pending === "number" ? j.pending : null))
      .catch(() => {});
  }, []);

  const totals = planTotals(counts);

  function setCount(direction: string, mode: ApplyMode, value: number, max: number) {
    setCounts((prev) => ({ ...prev, [direction]: { ...(prev[direction] ?? { referral: 0, direct: 0 }), [mode]: clampCount(value, max) } }));
  }

  async function start() {
    if (!groups) return;
    const plan = buildPlan(
      groups.map((g) => g.direction),
      counts
    );
    if (plan.length === 0) return;
    setStarting(true);
    try {
      await postJson("/api/executor/start", { kind: "apply", channel, options: { plan } });
      toast({
        title: m.apply.plan.scheduled(totals.total),
        description: channel === "user_chrome" ? m.apply.plan.scheduledUserChrome : m.apply.plan.scheduledHeadless,
        tone: "good",
      });
      setCounts((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, { referral: 0, direct: 0 }])));
      await refreshOverview();
    } catch (e) {
      toast({ title: m.apply.plan.startFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setStarting(false);
    }
  }

  async function startJdReview() {
    try {
      await postJson("/api/executor/start", { kind: "jd_review", channel: "headless", options: { limit: 40 } });
      toast({ title: m.apply.plan.jdStarted, description: m.apply.plan.jdStartedDescription, tone: "good" });
      await refreshOverview();
    } catch (e) {
      toast({ title: m.apply.plan.jdFailed, description: errorMessage(e), tone: "danger" });
    }
  }

  return (
    <Card id="plan" className="plan-card">
      <div className="row between">
        <div className="grow">
          <h3>{m.apply.plan.title}</h3>
          <p className="muted small">{m.apply.plan.description}</p>
        </div>
        <div className="row">
          <span className="muted small">
            {m.apply.plan.runsIn[channel]} · <Link href="/settings">{m.apply.plan.change}</Link>
          </span>
          <Menu
            label={m.common.more}
            items={[
              {
                label: m.apply.plan.jdMenuItem(pendingJd),
                icon: <FileText size={14} />,
                onSelect: startJdReview,
                disabled: jdBusy || pendingJd === 0,
              },
            ]}
          />
        </div>
      </div>

      {groups === null ? (
        <div className="mt-3">
          <SkeletonRows rows={4} />
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-3">
          <EmptyState compact title={m.apply.plan.emptyTitle} description={m.apply.plan.emptyDescription} />
        </div>
      ) : (
        <>
          <div className="table-scroll mt-3">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>{m.apply.plan.colTrack}</th>
                  <th>
                    {m.apply.plan.colReferral} <Tooltip content={m.apply.plan.referralTip} />
                  </th>
                  <th>
                    {m.apply.plan.colDirect} <Tooltip content={m.apply.plan.directTip} />
                  </th>
                  <th className="num">{m.apply.plan.colSubtotal}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const c = counts[g.direction] ?? { referral: 0, direct: 0 };
                  const name = directionName(g.direction, lang);
                  return (
                    <tr key={g.direction}>
                      <td>
                        <span className="strong">{name}</span> <Chip outline>{tierLabel(g.tier, lang)}</Chip>
                      </td>
                      <td>
                        <div className="row row-nowrap">
                          <Stepper value={c.referral} max={g.referralSuggested} disabled={applyBusy || g.referralSuggested === 0} onChange={(v) => setCount(g.direction, "referral", v, g.referralSuggested)} ariaLabel={m.apply.plan.referralCountAria(name)} />
                          <span className="muted xs nowrap">{m.apply.plan.available(g.referralSuggested)}</span>
                        </div>
                      </td>
                      <td>
                        <div className="row row-nowrap">
                          <Stepper value={c.direct} max={g.directSuggested} disabled={applyBusy || g.directSuggested === 0} onChange={(v) => setCount(g.direction, "direct", v, g.directSuggested)} ariaLabel={m.apply.plan.directCountAria(name)} />
                          <span className="muted xs nowrap">{m.apply.plan.available(g.directSuggested)}</span>
                        </div>
                      </td>
                      <td className="num mono">{c.referral + c.direct}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="plan-foot">
            <span>
              {m.apply.plan.totalPrefix} <strong className="mono">{totals.total}</strong> {m.apply.plan.totalUnit(totals.total)}
              <span className="muted">{m.apply.plan.totalBreakdown(totals.referral, totals.direct)}</span>
            </span>
            <Button variant="primary" icon={<Play size={14} />} loading={starting} disabled={applyBusy || totals.total === 0} onClick={start}>
              {applyBusy ? m.apply.plan.inProgress : m.apply.plan.start}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
