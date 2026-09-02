"use client";
import { useCallback, useEffect, useState } from "react";
import { directionLabel } from "@/matcher/directions";

interface DirectionGroup {
  direction: string;
  tier: number | null;
  matched: number;
  top: { score: number; company: string; title: string }[];
}

// Per-direction apply quota table: replaces the old single "前 N 个" input on /apply.
// Fetches GET /api/queue/by-direction on mount and lets the user set how many to submit for
// EACH direction (capped at that direction's matched count) — see the plan-mode protocol
// buildApplyPrompt implements over these {direction, count} entries.
export function ApplyQuotaTable({
  disabled,
  onStart,
}: {
  disabled?: boolean;
  onStart: (plan: { direction: string; count: number }[]) => void;
}) {
  const [groups, setGroups] = useState<DirectionGroup[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
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
        const next: Record<string, number> = {};
        for (const row of g) next[row.direction] = prev[row.direction] ?? 0;
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

  function setCount(direction: string, value: number, max: number) {
    const clamped = Math.max(0, Math.min(max, Number.isFinite(value) ? Math.floor(value) : 0));
    setCounts((prev) => ({ ...prev, [direction]: clamped }));
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  function start() {
    const plan = groups
      .map((g) => ({ direction: g.direction, count: counts[g.direction] ?? 0 }))
      .filter((p) => p.count > 0);
    onStart(plan);
  }

  if (loading) {
    return <p className="text-sub">加载方向队列…</p>;
  }
  if (error) {
    return <p className="text-accent">{error}</p>;
  }
  if (groups.length === 0) {
    return <p className="text-sub">队列中没有已匹配的职位可投。</p>;
  }

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>方向</th>
            <th className="num">队列中</th>
            <th className="num">投递数量</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.direction}>
              <td>
                {directionLabel(g.direction)}{" "}
                <span className="chip">梯队 {g.tier ?? "—"}</span>
              </td>
              <td className="num mono">{g.matched}</td>
              <td className="num">
                <input
                  type="number"
                  min={0}
                  max={g.matched}
                  value={counts[g.direction] ?? 0}
                  disabled={disabled}
                  onChange={(e) => setCount(g.direction, Number(e.target.value), g.matched)}
                  style={{ width: 64 }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <span className="text-sub" style={{ fontSize: 13 }}>
          本次共 <strong className="mono">{total}</strong> 份
        </span>
        <button onClick={start} disabled={disabled || total === 0}>
          开始投递
        </button>
      </div>
    </div>
  );
}
