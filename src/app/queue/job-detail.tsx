"use client";
import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Handshake, MapPin, Pin, PinOff, Send, SkipForward, Undo2 } from "lucide-react";
import { getJson, errorMessage } from "@/app/lib/api";
import { directionName, labelOf, modeLabel, tierLabel } from "@/app/lib/labels";
import { relativeDays } from "@/app/lib/time";
import { timePenalty, timePenaltyNote } from "@/app/lib/time-penalty";
import { cx } from "@/app/lib/cx";
import { Button, Chip, LinkButton, SkeletonRows } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";
import { isInQueue, truncateLocations, type JobRowData, type RowHandlers } from "./job-row";

export interface JobDetail {
  title: string;
  company: string;
  location: string | null;
  apply_url: string | null;
  jd_text: string | null;
  match: { direction: string | null; score: number | null; tier: number | null; reason: string | null };
  resume_version: string | null;
  jd_status: string | null;
  duplicate_of: number | null;
  skip_reason: string | null;
  sibling_locations: string | null;
  sponsorship: string | null;
  degree_req: string | null;
  role_kind: string | null;
}

export type JdState = { status: "loading" } | { status: "ready"; data: JobDetail } | { status: "error"; message: string };

const JD_CLAMP_CHARS = 1400;

// Fetches /api/jobs/:id once per row and keeps a small cache, so flipping between rows (or the
// same row in the side panel and the phone drawer) does not refetch.
export function useJobDetail(rowId: number | null): JdState | undefined {
  const [cache, setCache] = useState<Map<number, JdState>>(new Map());
  useEffect(() => {
    if (rowId == null) return;
    setCache((m) => (m.has(rowId) ? m : new Map(m).set(rowId, { status: "loading" })));
    let cancelled = false;
    getJson<JobDetail>(`/api/jobs/${rowId}`)
      .then((data) => {
        if (!cancelled) setCache((m) => new Map(m).set(rowId, { status: "ready", data }));
      })
      .catch((e) => {
        if (!cancelled) setCache((m) => new Map(m).set(rowId, { status: "error", message: errorMessage(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, [rowId]);
  return rowId == null ? undefined : cache.get(rowId);
}

export function DetailHead({ row, allTab }: { row: JobRowData; allTab: boolean }) {
  const m = useMessages();
  const lang = useLang();
  const loc = truncateLocations(row.location);
  return (
    <div className="row">
      {loc.full ? (
        <span className="muted small row row-nowrap gap-1" title={loc.full}>
          <MapPin size={13} aria-hidden /> {loc.display}
          {loc.extra > 0 ? ` +${loc.extra}` : ""}
        </span>
      ) : null}
      {!allTab ? (
        <span className="muted small row row-nowrap gap-1">
          <CalendarDays size={13} aria-hidden /> {m.queue.detail.posted(relativeDays(row.posted_at, lang).label)}
        </span>
      ) : null}
      {row.apply_url ? (
        <LinkButton href={row.apply_url} external size="sm" icon={<ExternalLink size={13} />}>
          {m.queue.actions.openApplyPage}
        </LinkButton>
      ) : null}
    </div>
  );
}

export interface DetailFooterProps {
  row: JobRowData;
  rows: JobRowData[];
  inQueue: boolean;
  busy: boolean;
  onNavigate: (id: number) => void;
  onPin: RowHandlers["onPin"];
  onSkip: RowHandlers["onSkip"];
}

export function DetailFooter({ row, rows, inQueue, busy, onNavigate, onPin, onSkip }: DetailFooterProps) {
  const m = useMessages();
  const idx = rows.findIndex((r) => r.id === row.id);
  const prev = idx > 0 ? rows[idx - 1] : null;
  const next = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
  return (
    <>
      <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} disabled={!prev} onClick={() => prev && onNavigate(prev.id)}>
        {m.queue.detail.prev}
      </Button>
      <Button variant="ghost" size="sm" disabled={!next} onClick={() => next && onNavigate(next.id)}>
        {m.queue.detail.next} <ChevronRight size={14} aria-hidden />
      </Button>
      <span className="grow" />
      {inQueue ? (
        <>
          <Button size="sm" icon={row.pinned ? <PinOff size={14} /> : <Pin size={14} />} disabled={busy} onClick={() => onPin(row, !row.pinned)}>
            {row.pinned ? m.common.unpin : m.common.pin}
          </Button>
          <Button size="sm" variant="danger" icon={<SkipForward size={14} />} disabled={busy} onClick={() => onSkip(row)}>
            {m.common.skip}
          </Button>
        </>
      ) : null}
    </>
  );
}

export function DetailBody({
  state,
  row,
  allTab,
  busy,
  onMode,
}: {
  state: JdState | undefined;
  row: JobRowData;
  allTab: boolean;
  busy: boolean;
  onMode: RowHandlers["onMode"];
}) {
  const m = useMessages();
  const lang = useLang();
  const [jdOpen, setJdOpen] = useState(false);
  useEffect(() => setJdOpen(false), [row.id]);
  if (!state || state.status === "loading") return <SkeletonRows rows={7} />;
  if (state.status === "error") return <div className="notice notice-danger">{m.queue.detail.loadFailed(state.message)}</div>;

  const d = state.data;
  const inQueue = isInQueue(row, allTab);
  const match = d.match;
  const scored = match.score != null;
  const hasEligibility = d.sponsorship || d.degree_req || d.role_kind || d.sibling_locations || d.skip_reason;
  const jdStatusLabel = d.jd_status ? labelOf(m.labels.jdStatus, d.jd_status, "") : "";
  const jd = d.jd_text?.trim() ?? "";
  const clamp = jd.length > JD_CLAMP_CHARS && !jdOpen;
  const mode = row.effective_mode;
  // 队列默认按「分数 − 时间惩罚」排序(src/app/lib/time-penalty.ts);把这个排序用的分和扣分理由摆出来,
  // 用户才看得懂为什么一条 88 分的岗排在 86 分后面。全部入库 tab 的行不参与这个排序,不显示。
  const ageDays = relativeDays(row.posted_at, lang).days;
  const penalty = inQueue ? timePenalty(ageDays, row.referral_fit === 1) : 0;

  return (
    <div className="col gap-4">
      <section className="detail-section">
        <h4>{m.queue.detail.match}</h4>
        {scored ? (
          <>
            <div className="detail-facts">
              <div>
                <div className="fact-label">{m.queue.detail.score}</div>
                <div className={cx("fact-value is-num", (match.score ?? 0) >= 85 && "text-accent")}>{match.score}</div>
              </div>
              {inQueue ? (
                <div>
                  <div className="fact-label">{m.queue.detail.composite}</div>
                  <div className="fact-value is-num" title={m.queue.detail.compositeTitle}>
                    {(match.score ?? 0) - penalty}
                  </div>
                </div>
              ) : null}
              <div>
                <div className="fact-label">{m.queue.detail.track}</div>
                <div className="fact-value">{directionName(match.direction, lang)}</div>
              </div>
              <div>
                <div className="fact-label">{m.queue.detail.tier}</div>
                <div className="fact-value">{tierLabel(match.tier, lang)}</div>
              </div>
              <div>
                <div className="fact-label">{m.queue.detail.resumeVersion}</div>
                <div className="fact-value mono small">{d.resume_version ?? "—"}</div>
              </div>
            </div>
            <p className="mt-3">{match.reason ?? <span className="muted">{m.queue.detail.noReason}</span>}</p>
            {inQueue ? <p className="muted small mt-2">{timePenaltyNote(ageDays, row.referral_fit === 1, lang)}</p> : null}
          </>
        ) : (
          <p className="muted">{m.queue.detail.notScored}</p>
        )}
      </section>

      {hasEligibility ? (
        <section className="detail-section">
          <h4>{m.queue.detail.eligibility}</h4>
          <div className="row">
            {d.sponsorship ? <Chip tone={d.sponsorship === "no" ? "danger" : d.sponsorship === "yes" ? "good" : "neutral"}>{labelOf(m.labels.sponsorship, d.sponsorship, d.sponsorship)}</Chip> : null}
            {d.degree_req ? <Chip tone={d.degree_req === "phd_only" ? "danger" : "neutral"}>{labelOf(m.labels.degree, d.degree_req, d.degree_req)}</Chip> : null}
            {d.role_kind ? <Chip tone={d.role_kind === "non_tech" ? "warn" : "neutral"}>{labelOf(m.labels.roleKind, d.role_kind, d.role_kind)}</Chip> : null}
            {jdStatusLabel ? <Chip tone="warn">{jdStatusLabel}</Chip> : null}
          </div>
          {d.sibling_locations ? <p className="muted small mt-2">{m.queue.detail.otherLocations(d.sibling_locations.split(" | ").join(" · "))}</p> : null}
          {d.skip_reason ? <p className="muted small mt-2">{m.queue.detail.archiveReason(d.skip_reason)}</p> : null}
        </section>
      ) : null}

      {inQueue ? (
        <section className="detail-section">
          <h4>{m.queue.detail.referral}</h4>
          <div className="row">
            <Chip tone={mode === "referral" ? "good" : "neutral"} size="md">
              {mode === "referral" ? m.queue.detail.suggestReferral : row.referral_fit == null ? m.queue.detail.undecided : m.queue.detail.suggestDirect}
            </Chip>
            {row.apply_mode ? <span className="muted small">{row.apply_mode === "referral" ? m.queue.detail.manualReferral : m.queue.detail.manualDirect}</span> : null}
          </div>
          {row.referral_reason ? <p className="muted small mt-2">{row.referral_reason}</p> : null}
          <div className="row mt-3">
            <Button size="sm" icon={mode === "referral" ? <Send size={13} /> : <Handshake size={13} />} disabled={busy} onClick={() => onMode(row, mode === "referral" ? "direct" : "referral")}>
              {mode === "referral" ? m.queue.actions.switchToDirect : m.queue.actions.switchToReferral}
            </Button>
            {row.apply_mode ? (
              <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} disabled={busy} onClick={() => onMode(row, null)}>
                {m.queue.actions.followSuggestion}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="detail-section">
        <h4>{m.queue.detail.description}</h4>
        {jd ? (
          <>
            <div className={cx("jd-text", clamp && "is-clamped")}>{jd}</div>
            {jd.length > JD_CLAMP_CHARS ? (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setJdOpen(!jdOpen)}>
                {jdOpen ? m.queue.detail.collapse : m.queue.detail.expand}
              </Button>
            ) : null}
          </>
        ) : (
          <p className="muted">{jdStatusLabel ? m.queue.detail.noDescriptionWithStatus(jdStatusLabel) : m.queue.detail.noDescription}</p>
        )}
      </section>
      <p className="faint xs">{m.queue.detail.footer(row.source ?? null, modeLabel(mode, row.referral_fit, lang), row.id)}</p>
    </div>
  );
}
