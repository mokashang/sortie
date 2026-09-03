"use client";
import { useCallback, useEffect, useState } from "react";
import { directionLabel } from "@/matcher/directions";

interface DirectionGroup {
  direction: string;
  tier: number | null;
  matched: number;
  referralSuggested: number;
  directSuggested: number;
  top: { score: number; company: string; title: string }[];
}

export type ApplyMode = "referral" | "direct";
export interface PlanEntry {
  direction: string;
  count: number;
  mode: ApplyMode;
}

type Counts = Record<string, { referral: number; direct: number }>;

// Per-direction apply quota table. Two pools per direction (spec §4.1): 找内推 draws from jobs
// whose effective mode is 'referral' (Claude's suggestion unless the user overrode it on /queue),
// 海投 from the 'direct' pool. Emits one plan entry per non-zero cell, referral entries first —
// see buildApplyPrompt / CLAUDE.md §3 for how the executor works through them.
export function ApplyQuotaTable({
  disabled,
  onStart,
}: {
  disabled?: boolean;
  onStart: (plan: PlanEntry[]) => void;
}) {
  const [groups, setGroups] = useState<DirectionGroup[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/queue/by-direction");
      if (!r.ok) {
        setError(`加载方向队列失败:${r.status}`);
        return;
      }
      const j = await r.json();
      const g: DirectionGroup[] = j.groups ?? [];
      setGroups(g);
      setCounts((prev) => {
        const next: Counts = {};
        for (const row of g) next[row.direction] = prev[row.direction] ?? { referral: 0, direct: 0 };
        return next;
      });
    } catch (e) {
      setError(`加载方向队列失败:${e}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function setCount(direction: string, mode: ApplyMode, value: number, max: number) {
    const clamped = Math.max(0, Math.min(max, Number.isFinite(value) ? Math.floor(value) : 0));
    setCounts((prev) => ({ ...prev, [direction]: { ...(prev[direction] ?? { referral: 0, direct: 0 }), [mode]: clamped } }));
  }

  const totalReferral = Object.values(counts).reduce((a, b) => a + b.referral, 0);
  const totalDirect = Object.values(counts).reduce((a, b) => a + b.direct, 0);
  const total = totalReferral + totalDirect;

  function start() {
    const plan: PlanEntry[] = [];
    for (const g of groups) {
      const c = counts[g.direction];
      if (c?.referral) plan.push({ direction: g.direction, count: c.referral, mode: "referral" });
    }
    for (const g of groups) {
      const c = counts[g.direction];
      if (c?.direct) plan.push({ direction: g.direction, count: c.direct, mode: "direct" });
    }
    onStart(plan);
  }

  if (loading) return <p className="text-sub">加载方向队列…</p>;
  if (error) return <p className="text-accent">{error}</p>;
  if (groups.length === 0) return <p className="text-sub">队列中没有已匹配的职位可投。</p>;

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>方向</th>
            <th className="num">找内推(建议)</th>
            <th className="num">海投(建议)</th>
            <th className="num">小计</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const c = counts[g.direction] ?? { referral: 0, direct: 0 };
            return (
              <tr key={g.direction}>
                <td>
                  {directionLabel(g.direction)} <span className="chip">梯队 {g.tier ?? "—"}</span>
                </td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    max={g.referralSuggested}
                    value={c.referral}
                    disabled={disabled || g.referralSuggested === 0}
                    onChange={(e) => setCount(g.direction, "referral", Number(e.target.value), g.referralSuggested)}
                    style={{ width: 56 }}
                  />
                  <span className="text-sub mono" style={{ marginLeft: 4 }}>/{g.referralSuggested}</span>
                </td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    max={g.directSuggested}
                    value={c.direct}
                    disabled={disabled || g.directSuggested === 0}
                    onChange={(e) => setCount(g.direction, "direct", Number(e.target.value), g.directSuggested)}
                    style={{ width: 56 }}
                  />
                  <span className="text-sub mono" style={{ marginLeft: 4 }}>/{g.directSuggested}</span>
                </td>
                <td className="num mono">{c.referral + c.direct}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-sub" style={{ fontSize: 12, margin: "6px 0 0" }}>
        找内推 = 值守会话先在 LinkedIn 找人要内推,岗位进入下方「内推进行中」等你批准消息;海投 = 直接填表等你确认。
        建议只是建议,可在「职位」页逐条改;「/N」是该模式当前可取的岗位数。
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <span className="text-sub" style={{ fontSize: 13 }}>
          本次共 <strong className="mono">{total}</strong> 份(找内推 {totalReferral} · 海投 {totalDirect})
        </span>
        <button onClick={start} disabled={disabled || total === 0}>
          开始投递
        </button>
      </div>
    </div>
  );
}
