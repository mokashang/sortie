"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText, Play } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { CHANNEL_LABEL, tierLabel } from "@/app/lib/labels";
import { buildPlan, clampCount, planTotals, type ApplyMode, type PlanCounts } from "@/app/lib/plan";
import { getChannel, type Channel } from "@/app/lib/settings";
import { Button, Card, Chip, EmptyState, Menu, SkeletonRows, Stepper, Tooltip, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";

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
      toast({ title: "加载方向队列失败", description: errorMessage(e), tone: "danger" });
      setGroups([]);
    }
  }, [toast]);

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
        title: `已安排投递 ${totals.total} 份`,
        description:
          channel === "user_chrome"
            ? "已排队,助手接手后在你的 Chrome 里开始;填好的申请会出现在下方「待确认」。"
            : "后台浏览器已开始;填好的申请会出现在下方「待确认」。",
        tone: "good",
      });
      setCounts((prev) => Object.fromEntries(Object.keys(prev).map((k) => [k, { referral: 0, direct: 0 }])));
      await refreshOverview();
    } catch (e) {
      toast({ title: "没能开始投递", description: errorMessage(e), tone: "danger" });
    } finally {
      setStarting(false);
    }
  }

  async function startJdReview() {
    try {
      await postJson("/api/executor/start", { kind: "jd_review", channel: "headless", options: { limit: 40 } });
      toast({ title: "已开始补正文", description: "后台浏览器会逐页读取没有正文的职位并核对资格。", tone: "good" });
      await refreshOverview();
    } catch (e) {
      toast({ title: "没能开始", description: errorMessage(e), tone: "danger" });
    }
  }

  return (
    <Card id="plan" className="plan-card">
      <div className="row between">
        <div className="grow">
          <h3>本次投递计划</h3>
          <p className="muted small">每个方向要投几份。找内推:助手先去 LinkedIn 找人;海投:助手直接填表。两者都要经你确认才会提交。</p>
        </div>
        <div className="row">
          <span className="muted small">
            将{CHANNEL_LABEL[channel]}操作 · <Link href="/settings">更改</Link>
          </span>
          <Menu
            label="更多"
            items={[
              {
                label: `补正文(后台逐页读)${pendingJd != null ? ` · 待补 ${pendingJd}` : ""}`,
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
          <EmptyState compact title="队列里没有可投的职位" description="扫描并打分之后,这里会按方向列出可投的数量。" />
        </div>
      ) : (
        <>
          <div className="table-scroll mt-3">
            <table className="plan-table">
              <thead>
                <tr>
                  <th>方向</th>
                  <th>
                    找内推 <Tooltip content="助手先在 LinkedIn 找人要内推;岗位进入「内推进行中」,消息要你批准后才发" />
                  </th>
                  <th>
                    海投 <Tooltip content="助手直接填表;填好后停在「待确认」,你点确认才提交" />
                  </th>
                  <th className="num">小计</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const c = counts[g.direction] ?? { referral: 0, direct: 0 };
                  const name = directionLabel(g.direction);
                  return (
                    <tr key={g.direction}>
                      <td>
                        <span className="strong">{name}</span> <Chip outline>{tierLabel(g.tier)}</Chip>
                      </td>
                      <td>
                        <div className="row row-nowrap">
                          <Stepper value={c.referral} max={g.referralSuggested} disabled={applyBusy || g.referralSuggested === 0} onChange={(v) => setCount(g.direction, "referral", v, g.referralSuggested)} ariaLabel={`${name} 找内推份数`} />
                          <span className="muted xs nowrap">可取 {g.referralSuggested}</span>
                        </div>
                      </td>
                      <td>
                        <div className="row row-nowrap">
                          <Stepper value={c.direct} max={g.directSuggested} disabled={applyBusy || g.directSuggested === 0} onChange={(v) => setCount(g.direction, "direct", v, g.directSuggested)} ariaLabel={`${name} 海投份数`} />
                          <span className="muted xs nowrap">可取 {g.directSuggested}</span>
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
              本次共 <strong className="mono">{totals.total}</strong> 份
              <span className="muted">(找内推 {totals.referral} · 海投 {totals.direct})</span>
            </span>
            <Button variant="primary" icon={<Play size={14} />} loading={starting} disabled={applyBusy || totals.total === 0} onClick={start}>
              {applyBusy ? "投递进行中" : "开始投递"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
