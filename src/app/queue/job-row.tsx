"use client";
import { ExternalLink, Handshake, Pin, PinOff, Send, SkipForward, Star, Undo2 } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { JD_STATUS_LABEL, modeLabel } from "@/app/lib/labels";
import { localShort, relativeDays } from "@/app/lib/time";
import { cx } from "@/app/lib/cx";
import { Chip, Menu } from "@/app/components/ui";
import type { MenuEntry } from "@/app/components/ui";

// Mirrors PagedQueueRow / PagedAllJobsRow from src/apply/queue.ts (copied so this client module
// never imports the db-backed server module).
export interface JobRowData {
  id: number;
  company: string;
  title: string;
  location: string | null;
  apply_url: string | null;
  direction: string | null;
  score: number | null;
  tier: number | null;
  reason?: string | null;
  posted_at: string | null;
  pinned: number;
  dup_count?: number;
  jd_status?: string | null;
  referral_fit?: number | null;
  apply_mode?: string | null;
  effective_mode?: "referral" | "direct";
  referral_reason?: string | null;
  // 全部入库 tab only
  created_at?: string;
  in_queue?: number;
  source?: string;
}

export type RowMode = "referral" | "direct" | null;

export interface RowHandlers {
  onPin: (row: JobRowData, pinned: boolean) => void;
  onMode: (row: JobRowData, mode: RowMode) => void;
  onSkip: (row: JobRowData) => void;
}

// jobs.location stores "City; City; City…" — some postings list 20+ cities. Show the first three.
export function truncateLocations(location: string | null): { display: string; full: string; extra: number } {
  if (!location) return { display: "—", full: "", extra: 0 };
  const parts = location.split(";").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 3) return { display: parts.join(" · "), full: location, extra: 0 };
  return { display: parts.slice(0, 3).join(" · "), full: parts.join(" · "), extra: parts.length - 3 };
}

export function isInQueue(row: JobRowData, allTab: boolean): boolean {
  return allTab ? row.in_queue === 1 : true;
}

export function rowMenuItems(row: JobRowData, allTab: boolean, busy: boolean, h: RowHandlers): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (row.apply_url) {
    const url = row.apply_url;
    items.push({ label: "打开申请页", icon: <ExternalLink size={14} />, onSelect: () => window.open(url, "_blank", "noopener") });
  }
  if (isInQueue(row, allTab)) {
    const referral = row.effective_mode === "referral";
    items.push({
      label: row.pinned ? "取消置顶" : "置顶",
      icon: row.pinned ? <PinOff size={14} /> : <Pin size={14} />,
      onSelect: () => h.onPin(row, !row.pinned),
      disabled: busy,
    });
    items.push({
      label: referral ? "改为海投" : "改为找内推",
      icon: referral ? <Send size={14} /> : <Handshake size={14} />,
      onSelect: () => h.onMode(row, referral ? "direct" : "referral"),
      disabled: busy,
    });
    if (row.apply_mode) {
      items.push({ label: "跟随建议", icon: <Undo2 size={14} />, onSelect: () => h.onMode(row, null), disabled: busy });
    }
    items.push("sep");
    items.push({ label: "跳过", icon: <SkipForward size={14} />, danger: true, onSelect: () => h.onSkip(row), disabled: busy });
  }
  return items;
}

export interface JobRowProps extends RowHandlers {
  row: JobRowData;
  allTab: boolean;
  active: boolean;
  busy: boolean;
  onOpen: (id: number) => void;
}

export function JobRow({ row, allTab, active, busy, onOpen, onPin, onMode, onSkip }: JobRowProps) {
  const loc = truncateLocations(row.location);
  const rel = relativeDays(row.posted_at);
  const inQueue = isInQueue(row, allTab);
  const mode = row.effective_mode;
  const jdLabel = row.jd_status ? JD_STATUS_LABEL[row.jd_status] : undefined;

  return (
    <div
      className={cx("job-row", active && "is-active", row.pinned ? "is-pinned" : null)}
      role="button"
      tabIndex={0}
      aria-label={`${row.company} · ${row.title}`}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(row.id);
        }
      }}
    >
      <div className={cx("job-score", (row.score ?? 0) >= 85 && "is-top", row.score == null && "is-none")} title="匹配分">
        {row.score ?? "—"}
      </div>
      <div className="job-main">
        <div className="job-line1">
          <span className="job-company">{row.company}</span>
          {row.pinned ? <Star size={12} className="job-pin" aria-label="已置顶" /> : null}
          <span className="job-title">{row.title}</span>
        </div>
        <div className="job-meta">
          <span className="truncate" title={loc.full || undefined}>
            {loc.display}
          </span>
          {loc.extra > 0 ? (
            <Chip outline title={loc.full}>
              +{loc.extra} 地点
            </Chip>
          ) : null}
          {(row.dup_count ?? 0) > 0 ? (
            <Chip outline title="同一职位的其他地点已合并到这一行">
              另有 {row.dup_count} 个地点
            </Chip>
          ) : null}
          {jdLabel ? (
            <Chip outline tone="warn">
              {jdLabel}
            </Chip>
          ) : null}
          {allTab && row.direction ? <Chip outline>{directionLabel(row.direction)}</Chip> : null}
        </div>
      </div>
      <div className="job-side">
        <span className="job-when mono" title={allTab ? "入库时间" : row.posted_at ? `发布于 ${row.posted_at.slice(0, 10)}` : "来源没有给发布日期"}>
          {allTab ? localShort(row.created_at ?? null) : rel.label}
        </span>
        {!allTab && rel.fresh ? <Chip tone="good">新</Chip> : null}
        {mode && inQueue ? (
          <Chip tone={mode === "referral" ? "good" : "neutral"} title={row.referral_reason ?? undefined}>
            {row.apply_mode ? "手动 · " : ""}
            {modeLabel(mode, row.referral_fit)}
          </Chip>
        ) : null}
        <Menu items={rowMenuItems(row, allTab, busy, { onPin, onMode, onSkip })} label="更多操作" />
      </div>
    </div>
  );
}
