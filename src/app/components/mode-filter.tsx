"use client";

export type ModeFilterValue = "all" | "referral" | "direct";

// 全部 / 建议内推 / 海投 chip strip. Shared by /queue (filters the current direction tab by
// effective apply mode) and /history (filters by how the application was actually submitted).
export function ModeFilter({
  value,
  onChange,
  counts,
  labels,
  disabled,
}: {
  value: ModeFilterValue;
  onChange: (v: ModeFilterValue) => void;
  counts?: Partial<Record<ModeFilterValue, number>>;
  labels?: Partial<Record<ModeFilterValue, string>>;
  disabled?: boolean;
}) {
  const items: { key: ModeFilterValue; label: string }[] = [
    { key: "all", label: labels?.all ?? "全部" },
    { key: "referral", label: labels?.referral ?? "建议内推" },
    { key: "direct", label: labels?.direct ?? "海投" },
  ];
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className="btn-ghost"
          disabled={disabled}
          onClick={() => onChange(it.key)}
          style={value === it.key ? { fontWeight: 700, borderColor: "var(--ink)" } : undefined}
        >
          {it.label}
          {counts?.[it.key] != null ? <span className="tab-count">{counts[it.key]}</span> : null}
        </button>
      ))}
    </div>
  );
}
