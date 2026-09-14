"use client";
import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Handshake, MapPin, Pin, PinOff, Send, SkipForward, Undo2 } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson, errorMessage } from "@/app/lib/api";
import { DEGREE_LABEL, JD_STATUS_LABEL, ROLE_KIND_LABEL, SPONSORSHIP_LABEL, labelOf, modeLabel, tierLabel } from "@/app/lib/labels";
import { relativeDays } from "@/app/lib/time";
import { timePenalty, timePenaltyNote } from "@/app/lib/time-penalty";
import { cx } from "@/app/lib/cx";
import { Button, Chip, LinkButton, SkeletonRows } from "@/app/components/ui";
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
          <CalendarDays size={13} aria-hidden /> 发布 {relativeDays(row.posted_at).label}
        </span>
      ) : null}
      {row.apply_url ? (
        <LinkButton href={row.apply_url} external size="sm" icon={<ExternalLink size={13} />}>
          打开申请页
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
  const idx = rows.findIndex((r) => r.id === row.id);
  const prev = idx > 0 ? rows[idx - 1] : null;
  const next = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
  return (
    <>
      <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} disabled={!prev} onClick={() => prev && onNavigate(prev.id)}>
        上一条
      </Button>
      <Button variant="ghost" size="sm" disabled={!next} onClick={() => next && onNavigate(next.id)}>
        下一条 <ChevronRight size={14} aria-hidden />
      </Button>
      <span className="grow" />
      {inQueue ? (
        <>
          <Button size="sm" icon={row.pinned ? <PinOff size={14} /> : <Pin size={14} />} disabled={busy} onClick={() => onPin(row, !row.pinned)}>
            {row.pinned ? "取消置顶" : "置顶"}
          </Button>
          <Button size="sm" variant="danger" icon={<SkipForward size={14} />} disabled={busy} onClick={() => onSkip(row)}>
            跳过
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
  const [jdOpen, setJdOpen] = useState(false);
  useEffect(() => setJdOpen(false), [row.id]);
  if (!state || state.status === "loading") return <SkeletonRows rows={7} />;
  if (state.status === "error") return <div className="notice notice-danger">加载失败:{state.message}</div>;

  const d = state.data;
  const inQueue = isInQueue(row, allTab);
  const m = d.match;
  const scored = m.score != null;
  const hasEligibility = d.sponsorship || d.degree_req || d.role_kind || d.sibling_locations || d.skip_reason;
  const jd = d.jd_text?.trim() ?? "";
  const clamp = jd.length > JD_CLAMP_CHARS && !jdOpen;
  const mode = row.effective_mode;
  // 队列默认按「分数 − 时间惩罚」排序(src/app/lib/time-penalty.ts);把这个排序用的分和扣分理由摆出来,
  // 用户才看得懂为什么一条 88 分的岗排在 86 分后面。全部入库 tab 的行不参与这个排序,不显示。
  const ageDays = relativeDays(row.posted_at).days;
  const penalty = inQueue ? timePenalty(ageDays, row.referral_fit === 1) : 0;

  return (
    <div className="col gap-4">
      <section className="detail-section">
        <h4>匹配</h4>
        {scored ? (
          <>
            <div className="detail-facts">
              <div>
                <div className="fact-label">分数</div>
                <div className={cx("fact-value is-num", (m.score ?? 0) >= 85 && "text-accent")}>{m.score}</div>
              </div>
              {inQueue ? (
                <div>
                  <div className="fact-label">排序综合分</div>
                  <div className="fact-value is-num" title="分数减去时间惩罚,职位队列默认按它排序">
                    {(m.score ?? 0) - penalty}
                  </div>
                </div>
              ) : null}
              <div>
                <div className="fact-label">方向</div>
                <div className="fact-value">{m.direction ? directionLabel(m.direction) : "未分类"}</div>
              </div>
              <div>
                <div className="fact-label">优先级</div>
                <div className="fact-value">{tierLabel(m.tier)}</div>
              </div>
              <div>
                <div className="fact-label">简历版本</div>
                <div className="fact-value mono small">{d.resume_version ?? "—"}</div>
              </div>
            </div>
            <p className="mt-3">{m.reason ?? <span className="muted">没有记录打分理由。</span>}</p>
            {inQueue ? <p className="muted small mt-2">{timePenaltyNote(ageDays, row.referral_fit === 1)}</p> : null}
          </>
        ) : (
          <p className="muted">还没有打分。扫描后的职位会陆续由助手评分。</p>
        )}
      </section>

      {hasEligibility ? (
        <section className="detail-section">
          <h4>资格</h4>
          <div className="row">
            {d.sponsorship ? <Chip tone={d.sponsorship === "no" ? "danger" : d.sponsorship === "yes" ? "good" : "neutral"}>{labelOf(SPONSORSHIP_LABEL, d.sponsorship, d.sponsorship)}</Chip> : null}
            {d.degree_req ? <Chip tone={d.degree_req === "phd_only" ? "danger" : "neutral"}>{labelOf(DEGREE_LABEL, d.degree_req, d.degree_req)}</Chip> : null}
            {d.role_kind ? <Chip tone={d.role_kind === "non_tech" ? "warn" : "neutral"}>{labelOf(ROLE_KIND_LABEL, d.role_kind, d.role_kind)}</Chip> : null}
            {d.jd_status && JD_STATUS_LABEL[d.jd_status] ? <Chip tone="warn">{JD_STATUS_LABEL[d.jd_status]}</Chip> : null}
          </div>
          {d.sibling_locations ? <p className="muted small mt-2">其他地点:{d.sibling_locations.split(" | ").join(" · ")}</p> : null}
          {d.skip_reason ? <p className="muted small mt-2">归档原因:{d.skip_reason}</p> : null}
        </section>
      ) : null}

      {inQueue ? (
        <section className="detail-section">
          <h4>内推建议</h4>
          <div className="row">
            <Chip tone={mode === "referral" ? "good" : "neutral"} size="md">
              {mode === "referral" ? "建议先找内推" : row.referral_fit == null ? "尚未判定" : "建议海投"}
            </Chip>
            {row.apply_mode ? <span className="muted small">已手动改为{row.apply_mode === "referral" ? "找内推" : "海投"}</span> : null}
          </div>
          {row.referral_reason ? <p className="muted small mt-2">{row.referral_reason}</p> : null}
          <div className="row mt-3">
            <Button size="sm" icon={mode === "referral" ? <Send size={13} /> : <Handshake size={13} />} disabled={busy} onClick={() => onMode(row, mode === "referral" ? "direct" : "referral")}>
              {mode === "referral" ? "改为海投" : "改为找内推"}
            </Button>
            {row.apply_mode ? (
              <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} disabled={busy} onClick={() => onMode(row, null)}>
                跟随建议
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="detail-section">
        <h4>职位描述</h4>
        {jd ? (
          <>
            <div className={cx("jd-text", clamp && "is-clamped")}>{jd}</div>
            {jd.length > JD_CLAMP_CHARS ? (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setJdOpen(!jdOpen)}>
                {jdOpen ? "收起" : "展开全文"}
              </Button>
            ) : null}
          </>
        ) : (
          <p className="muted">{d.jd_status && JD_STATUS_LABEL[d.jd_status] ? `${JD_STATUS_LABEL[d.jd_status]}:还没有抓到职位描述。` : "还没有抓到职位描述。"}</p>
        )}
      </section>
      <p className="faint xs">
        {row.source ? `来源 ${row.source} · ` : ""}
        {modeLabel(mode, row.referral_fit)} · 编号 #{row.id}
      </p>
    </div>
  );
}
