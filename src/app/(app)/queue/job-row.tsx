"use client";
import { ExternalLink, Handshake, Pin, PinOff, Send, SkipForward, Star, Undo2 } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { labelOf, modeLabel } from "@/app/lib/labels";
import { localShort, relativeDays } from "@/app/lib/time";
import { TIME_PENALTY_RULE, timePenalty } from "@/app/lib/time-penalty";
import { cx } from "@/app/lib/cx";
import { Chip, Menu } from "@/app/components/ui";
import type { MenuEntry } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";

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

// Not a component, so the caller hands in the message tree it got from useMessages().
export function rowMenuItems(row: JobRowData, allTab: boolean, busy: boolean, h: RowHandlers, m: Messages): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (row.apply_url) {
    const url = row.apply_url;
    items.push({ label: m.queue.actions.openApplyPage, icon: <ExternalLink size={14} />, onSelect: () => window.open(url, "_blank", "noopener") });
  }
  if (isInQueue(row, allTab)) {
    const referral = row.effective_mode === "referral";
    items.push({
      label: row.pinned ? m.common.unpin : m.common.pin,
      icon: row.pinned ? <PinOff size={14} /> : <Pin size={14} />,
      onSelect: () => h.onPin(row, !row.pinned),
      disabled: busy,
    });
    items.push({
      label: referral ? m.queue.actions.switchToDirect : m.queue.actions.switchToReferral,
      icon: referral ? <Send size={14} /> : <Handshake size={14} />,
      onSelect: () => h.onMode(row, referral ? "direct" : "referral"),
      disabled: busy,
    });
    if (row.apply_mode) {
      items.push({ label: m.queue.actions.followSuggestion, icon: <Undo2 size={14} />, onSelect: () => h.onMode(row, null), disabled: busy });
    }
    items.push("sep");
    items.push({ label: m.common.skip, icon: <SkipForward size={14} />, danger: true, onSelect: () => h.onSkip(row), disabled: busy });
  }
  return items;
}

export interface JobRowProps extends RowHandlers {
  row: JobRowData;
  allTab: boolean;
  active: boolean;
  busy: boolean;
  onOpen: (id: number) => void;
  // Multi-select (track tabs only): when `selectable` the row grows a checkbox column; shift-click
  // is passed through so the list can extend the selection as a range.
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (row: JobRowData, selected: boolean, shiftKey: boolean) => void;
}

export function JobRow({ row, allTab, active, busy, onOpen, onPin, onMode, onSkip, selectable, selected, onSelect }: JobRowProps) {
  const m = useMessages();
  const lang = useLang();
  const loc = truncateLocations(row.location);
  const rel = relativeDays(row.posted_at, lang);
  const inQueue = isInQueue(row, allTab);
  const mode = row.effective_mode;
  const jdLabel = row.jd_status ? labelOf(m.labels.jdStatus, row.jd_status, "") || undefined : undefined;
  // 队列默认排序 = 分数 − 时间惩罚(src/app/lib/time-penalty.ts);悬停发布列能看到这条扣了几分。
  const penalty = allTab ? 0 : timePenalty(rel.days, row.referral_fit === 1);
  const modeText = modeLabel(mode, row.referral_fit, lang);

  return (
    <div
      className={cx("job-row", active && "is-active", row.pinned ? "is-pinned" : null, selectable && "is-selectable", selected && "is-selected")}
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
      {selectable ? (
        <label
          className="job-check"
          title={m.queue.select.row}
          // The whole row is a button that opens the detail; the checkbox must not.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={!!selected}
            aria-label={`${m.queue.select.row}: ${row.company} · ${row.title}`}
            // React raises a checkbox's onChange from the click, so the modifier keys ride along.
            onChange={(e) => onSelect?.(row, e.target.checked, (e.nativeEvent as MouseEvent).shiftKey === true)}
          />
        </label>
      ) : null}
      <div className={cx("job-score", (row.score ?? 0) >= 90 && "is-top", row.score == null && "is-none")} title={m.queue.row.scoreTitle}>
        {row.score ?? "—"}
      </div>
      <div className="job-main">
        <div className="job-line1">
          <span className="job-company">{row.company}</span>
          {row.pinned ? <Star size={12} className="job-pin" aria-label={m.queue.row.pinned} /> : null}
          <span className="job-title">{row.title}</span>
        </div>
        <div className="job-meta">
          <span className="truncate" title={loc.full || undefined}>
            {loc.display}
          </span>
          {loc.extra > 0 ? (
            <Chip outline title={loc.full}>
              {m.queue.row.moreLocations(loc.extra)}
            </Chip>
          ) : null}
          {(row.dup_count ?? 0) > 0 ? (
            <Chip outline title={m.queue.row.dupTitle}>
              {m.queue.row.dupCount(row.dup_count ?? 0)}
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
        <span
          className="job-when mono"
          title={
            allTab
              ? m.queue.row.addedAtTitle
              : row.posted_at
              ? m.queue.row.postedOn(row.posted_at.slice(0, 10), penalty)
              : m.queue.row.noPostedDate(TIME_PENALTY_RULE.unknownAgeDays, penalty)
          }
        >
          {allTab ? localShort(row.created_at ?? null) : rel.label}
        </span>
        {!allTab && rel.fresh ? <Chip tone="good">{m.queue.row.fresh}</Chip> : null}
        {mode && inQueue ? (
          <Chip tone={mode === "referral" ? "good" : "neutral"} title={row.referral_reason ?? undefined}>
            {row.apply_mode ? m.queue.row.manualMode(modeText) : modeText}
          </Chip>
        ) : null}
        <Menu items={rowMenuItems(row, allTab, busy, { onPin, onMode, onSkip }, m)} label={m.queue.actions.moreActions} />
      </div>
    </div>
  );
}
