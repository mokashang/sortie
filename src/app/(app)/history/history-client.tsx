"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { directionName, type Tone } from "@/app/lib/labels";
import type { MailEventRow } from "@/inbox/store";
import type { MailOutcome } from "@/inbox/classify";
import { POST_SUBMIT_STAGES, stageLabels, type HistoryRow, type PostSubmitStage } from "@/apply/stages";
import { postJson, errorMessage } from "@/app/lib/api";
import { Chip, EmptyState, LinkButton, PromptDialog, Section, Segmented, Stat, StatStrip, Tabs, useToast } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";
import { HistorySankey } from "./history-sankey";
import { StageMenu, stageTone } from "./stage-menu";

const ALL = "__all__";
type ModeFilter = "all" | "referral" | "direct";

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function mailTone(outcome: MailOutcome): Tone {
  switch (outcome) {
    case "offer":
      return "warn";
    case "oa":
    case "interview":
      return "good";
    case "rejected":
      return "danger";
    case "received":
    case "other":
      return "info";
    default:
      return "neutral";
  }
}

// 邮件动态: what 邮箱同步 read, newest first, collapsed to a handful until expanded.
function MailFeed({ events }: { events: MailEventRow[] }) {
  const m = useMessages();
  const [expanded, setExpanded] = useState(false);
  if (events.length === 0) return null;
  const shown = expanded ? events : events.slice(0, 6);
  return (
    <Section
      title={m.inbox.history.feedTitle}
      count={events.length}
      description={m.inbox.history.feedDescription}
      actions={
        events.length > 6 ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? m.inbox.history.collapse : m.inbox.history.showAll(events.length)}
          </button>
        ) : null
      }
    >
      <div className="history-list">
        {shown.map((e) => (
          <div key={e.id} className="history-row">
            <span className="mono muted small history-time">{e.receivedAt.slice(5)}</span>
            <div className="history-main">
              <div className="row">
                <Mail size={13} aria-hidden className="muted" />
                <span className="serif strong">{e.company ?? e.from}</span>
                <span className="truncate" style={{ maxWidth: 420 }} title={e.subject}>
                  {e.subject}
                </span>
              </div>
              <div className="row mt-1">
                <Chip tone={mailTone(e.outcome)}>{m.inbox.outcome[e.outcome]}</Chip>
                {e.applied ? <Chip outline>{m.inbox.history.applied}</Chip> : null}
                {e.jobId == null ? <Chip outline>{m.inbox.history.unmatched}</Chip> : null}
                {e.jobId != null && !e.applied && (e.outcome === "rejected" || e.outcome === "oa" || e.outcome === "interview" || e.outcome === "offer") ? (
                  <Chip outline>{m.inbox.history.lowConfidence}</Chip>
                ) : null}
                {e.summary ? (
                  <span className="muted small truncate" style={{ maxWidth: 420 }} title={e.summary}>
                    {e.summary}
                  </span>
                ) : null}
              </div>
              {e.nextStep ? (
                <div className="small mt-1">
                  <span className="muted">{m.inbox.history.nextStep}:</span> {e.nextStep}
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function HistoryClient({ rows: initial, mailEvents = [] }: { rows: HistoryRow[]; mailEvents?: MailEventRow[] }) {
  const m = useMessages();
  const lang = useLang();
  const STAGE = stageLabels(lang);
  const [rows, setRows] = useState(initial);
  const [direction, setDirection] = useState<string>(ALL);
  const [mode, setMode] = useState<ModeFilter>("all");
  const [pending, setPending] = useState<{ row: HistoryRow; stage: PostSubmitStage } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const { toast } = useToast();
  const router = useRouter();

  const tabs = useMemo(() => {
    const counts = new Map<string | null, number>();
    for (const r of rows) counts.set(r.direction, (counts.get(r.direction) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => {
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      return b[1] - a[1];
    });
  }, [rows]);

  const visible = rows.filter((r) => (direction === ALL || (r.direction ?? "") === direction) && (mode === "all" || r.applyMode === mode));
  const modeCounts = {
    all: rows.length,
    referral: rows.filter((r) => r.applyMode === "referral").length,
    direct: rows.filter((r) => r.applyMode === "direct").length,
  };

  const stageCounts = useMemo(() => {
    const counts = new Map<PostSubmitStage, number>();
    for (const r of visible) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    return counts;
  }, [visible]);

  // The stage ledger only earns its place once something has moved past 已提交.
  const stageTiles = POST_SUBMIT_STAGES.filter((s) => (stageCounts.get(s) ?? 0) > 0 || s === "submitted");

  const days = useMemo(() => {
    const groups: { day: string; rows: HistoryRow[] }[] = [];
    for (const r of visible) {
      const last = groups[groups.length - 1];
      if (last && last.day === r.submittedDay) last.rows.push(r);
      else groups.push({ day: r.submittedDay, rows: [r] });
    }
    return groups;
  }, [visible]);

  async function changeStage(row: HistoryRow, stage: PostSubmitStage, note: string) {
    setBusyId(row.jobId);
    try {
      await postJson("/api/apply/stage", { jobId: row.jobId, stage, note: note || undefined });
      setRows((prev) => prev.map((r) => (r.jobId === row.jobId ? { ...r, status: stage, updatedAt: nowLocal(), lastNote: note || r.lastNote } : r)));
      toast({ title: m.history.stage.changed(row.company, STAGE[stage]), tone: "good" });
      setPending(null);
      router.refresh();
    } catch (e) {
      toast({ title: m.history.stage.updateFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        art="ledger"
        title={m.history.empty.title}
        description={m.history.empty.description}
        action={<LinkButton href="/apply">{m.history.empty.action}</LinkButton>}
      />
    );
  }

  return (
    <div>
      {stageTiles.length > 1 ? (
        <StatStrip compact>
          {stageTiles.map((s) => (
            <Stat key={s} label={STAGE[s]} value={stageCounts.get(s) ?? 0} tone={stageTone(s) === "warn" ? "warn" : stageTone(s) === "good" ? "good" : undefined} />
          ))}
        </StatStrip>
      ) : null}

      <HistorySankey rows={visible} />

      <MailFeed events={mailEvents} />

      <Tabs
        ariaLabel={m.history.filters.track}
        value={direction}
        onChange={setDirection}
        items={[{ key: ALL, label: m.common.all, count: rows.length }, ...tabs.map(([dir, n]) => ({ key: dir ?? "", label: directionName(dir, lang), count: n }))]}
      />
      <div className="row mb-4">
        <Segmented<ModeFilter>
          ariaLabel={m.history.filters.mode}
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: "all", label: m.common.all, count: modeCounts.all },
            { value: "referral", label: m.labels.mode.referral, count: modeCounts.referral },
            { value: "direct", label: m.labels.mode.direct, count: modeCounts.direct },
          ]}
        />
      </div>

      {days.length === 0 ? (
        <EmptyState compact title={m.history.filters.noMatch} />
      ) : (
        days.map((g) => (
          <Section key={g.day} title={g.day} count={g.rows.length}>
            <div className="history-list">
              {g.rows.map((r) => (
                <div key={r.jobId} className="history-row">
                  <span className="mono muted small history-time">{r.submittedAt.slice(11)}</span>
                  <div className="history-main">
                    <div className="row">
                      <span className="serif strong">{r.company}</span>
                      {r.applyUrl ? (
                        <a href={r.applyUrl} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      ) : (
                        <span>{r.title}</span>
                      )}
                    </div>
                    <div className="row mt-1">
                      <Chip outline>{directionName(r.direction, lang)}</Chip>
                      {r.applyMode === "referral" ? <Chip tone="good">{m.history.row.referralVia(r.referralPersonName)}</Chip> : <Chip>{m.labels.mode.direct}</Chip>}
                      {r.resumeVersion ? <span className="muted xs mono">{m.history.row.resume(r.resumeVersion)}</span> : null}
                      {r.lastMail ? (
                        <Chip tone={mailTone(r.lastMail.outcome)} icon={<Mail size={11} />} title={[r.lastMail.subject, r.lastMail.summary, r.lastMail.nextStep].filter(Boolean).join(" · ")}>
                          {m.inbox.history.chip(m.inbox.outcome[r.lastMail.outcome])}
                        </Chip>
                      ) : null}
                      {r.lastNote ? (
                        <span className="muted small truncate" style={{ maxWidth: 360 }} title={r.lastNote}>
                          {r.lastNote}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="history-side">
                    <StageMenu value={r.status} busy={busyId === r.jobId} onChange={(stage) => setPending({ row: r, stage })} />
                    <span className="muted xs mono nowrap" title={m.history.row.lastUpdated}>
                      {r.updatedAt.slice(5)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ))
      )}

      <PromptDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onSubmit={(note) => {
          if (pending) void changeStage(pending.row, pending.stage, note);
        }}
        busy={pending !== null && busyId === pending.row.jobId}
        title={pending ? m.history.stage.changed(pending.row.company, STAGE[pending.stage]) : ""}
        description={m.history.stage.noteDescription}
        label={m.history.stage.noteLabel}
        placeholder={m.history.stage.notePlaceholder}
        submitLabel={m.history.stage.submit}
        multiline
      />
    </div>
  );
}
