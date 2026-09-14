"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListChecks, Square } from "lucide-react";
import { LogoMark } from "./shell/logo";
import type { RunStatusRow } from "@/executor/runner";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { RUN_STATUS_TONE, labelOf } from "@/app/lib/labels";
import { describeRun } from "@/app/lib/describe-run";
import { parseLog, parseLogLine } from "@/app/lib/log-steps";
import { localShort } from "@/app/lib/time";
import { cx } from "@/app/lib/cx";
import { Button, Card, Chip, ConfirmDialog, Dialog, RelativeTime, SkeletonRows, useToast } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";
import { useOverview } from "./overview-context";

export const isLive = (status: string) => status === "queued" || status === "running";

// The last 10 tasks, polled every 3s while mounted (the same endpoint reaps dead runs first).
export function useRuns(intervalMs = 3000) {
  const [runs, setRuns] = useState<RunStatusRow[] | null>(null);
  const refresh = useCallback(async () => {
    try {
      const j = await getJson<{ runs: RunStatusRow[] }>("/api/executor/status");
      setRuns(j.runs ?? []);
    } catch {
      // transient — keep the last known list
    }
  }, []);
  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);
  return { runs, refresh };
}

export interface AssistantCardProps {
  variant?: "full" | "compact";
  // Only consider tasks of these kinds (the 人脉 page cares about network_send/network_find).
  filterKinds?: string[];
  // Rendered inside the head row, right of the status (page-specific start buttons).
  actions?: React.ReactNode;
}

export function AssistantCard({ variant = "full", filterKinds, actions }: AssistantCardProps) {
  const m = useMessages();
  const lang = useLang();
  const { runs, refresh } = useRuns();
  const { refresh: refreshOverview } = useOverview();
  const { toast } = useToast();
  const [stepsFor, setStepsFor] = useState<RunStatusRow | null>(null);
  const [stopFor, setStopFor] = useState<RunStatusRow | null>(null);
  const [stopping, setStopping] = useState(false);

  const relevant = useMemo(() => (runs ?? []).filter((r) => !filterKinds || filterKinds.includes(r.kind)), [runs, filterKinds]);
  const run = relevant.find((r) => isLive(r.status)) ?? relevant[0] ?? null;
  const live = !!run && isLive(run.status);
  const lastLine = run?.logTail?.length ? parseLogLine(run.logTail[run.logTail.length - 1]) : null;

  async function stop() {
    if (!stopFor) return;
    setStopping(true);
    try {
      await postJson("/api/executor/stop", { runId: stopFor.id });
      toast({ title: m.assistant.stoppedTask(stopFor.id), tone: "neutral" });
      setStopFor(null);
      await refresh();
      await refreshOverview();
    } catch (e) {
      toast({ title: m.assistant.stopFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setStopping(false);
    }
  }

  const statusChip = run ? (
    <Chip tone={RUN_STATUS_TONE[run.status] ?? "neutral"}>{labelOf(m.labels.runStatus, run.status, run.status)}</Chip>
  ) : (
    <Chip>{m.assistant.idle}</Chip>
  );

  return (
    <>
      <Card className={cx("assistant-card", variant === "compact" && "assistant-compact")}>
        <div className="assistant-head">
          <div className="assistant-name">
            <span className={cx("dot", run?.status === "running" && "is-running", run?.status === "queued" && "is-queued")} aria-hidden />
            <LogoMark size={16} />
            <span>{m.common.assistant}</span>
            {statusChip}
            {run ? (
              <span className="muted small">
                {labelOf(m.labels.runKind, run.kind, run.kind)}
                {describeRun(run.kind, run.options, lang) ? ` · ${describeRun(run.kind, run.options, lang)}` : ""}
              </span>
            ) : null}
          </div>
          <div className="row">
            {actions}
            {run ? (
              <Button size="sm" variant="ghost" icon={<ListChecks size={14} />} onClick={() => setStepsFor(run)}>
                {m.assistant.viewSteps}
              </Button>
            ) : null}
            {live ? (
              <Button size="sm" variant="danger" icon={<Square size={12} />} onClick={() => setStopFor(run)}>
                {m.common.stop}
              </Button>
            ) : null}
          </div>
        </div>

        {runs === null ? (
          <div className="assistant-body">
            <SkeletonRows rows={1} />
          </div>
        ) : live && run ? (
          <div className="assistant-body">
            {run.status === "queued" ? (
              <p className="small">
                {m.assistant.queued(labelOf(m.labels.channel, run.channel, run.channel))}
                {run.channel === "user_chrome" ? <span className="muted">{m.assistant.queuedChromeNote}</span> : null}
              </p>
            ) : (
              <div className="assistant-last">
                <span className="muted small nowrap">{m.assistant.lastStep}</span>
                <span>{lastLine?.text ?? m.assistant.waitingFirstStep}</span>
              </div>
            )}
            <p className="muted xs mt-2">
              {m.assistant.startedPrefix}<RelativeTime value={run.startedAt} /> · {m.assistant.taskRef(run.id)}
            </p>
          </div>
        ) : (
          <div className="assistant-body muted small">
            {run ? (
              <>
                <div>
                  {m.assistant.lastPrefix}
                  {labelOf(m.labels.runKind, run.kind, run.kind)} · {labelOf(m.labels.runStatus, run.status, run.status)} ·{" "}
                  <RelativeTime value={run.endedAt ?? run.startedAt} />
                </div>
                {run.summary ? <RunSummary text={run.summary} /> : null}
              </>
            ) : (
              m.assistant.noTasksYet
            )}
          </div>
        )}

        {variant === "full" && relevant.length > 0 ? (
          <details className="assistant-history">
            <summary>{m.assistant.history(relevant.length)}</summary>
            <div className="table-scroll mt-2">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{m.assistant.columns.kind}</th>
                    <th>{m.assistant.columns.details}</th>
                    <th>{m.assistant.columns.status}</th>
                    <th>{m.assistant.columns.started}</th>
                    <th>{m.assistant.columns.ended}</th>
                    <th>{m.assistant.columns.result}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {relevant.map((r) => (
                    <tr key={r.id}>
                      <td className="mono muted">{r.id}</td>
                      <td>{labelOf(m.labels.runKind, r.kind, r.kind)}</td>
                      <td className="muted small">{describeRun(r.kind, r.options, lang) || labelOf(m.labels.channel, r.channel, r.channel)}</td>
                      <td>
                        <Chip tone={RUN_STATUS_TONE[r.status] ?? "neutral"}>{labelOf(m.labels.runStatus, r.status, r.status)}</Chip>
                      </td>
                      <td className="mono muted small nowrap">{localShort(r.startedAt)}</td>
                      <td className="mono muted small nowrap">{localShort(r.endedAt)}</td>
                      <td className="muted small" style={{ maxWidth: 320 }}>{r.summary ?? ""}</td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setStepsFor(r)}>
                          {m.assistant.steps}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ) : null}
      </Card>

      {stepsFor ? <RunStepsDialog run={stepsFor} open onClose={() => setStepsFor(null)} /> : null}
      <ConfirmDialog
        open={stopFor !== null}
        onClose={() => setStopFor(null)}
        onConfirm={stop}
        busy={stopping}
        danger
        title={m.assistant.stopDialog.title}
        description={m.assistant.stopDialog.description}
        confirmLabel={m.common.stop}
      />
    </>
  );
}

// A run summary can be a paragraph (jd_review lists every job it read); show two lines, expand on demand.
function RunSummary({ text }: { text: string }) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const long = text.length > 140;
  return (
    <div>
      <div className={cx("assistant-summary", long && !open && "is-clamped")}>{text}</div>
      {long ? (
        <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)}>
          {open ? m.assistant.collapse : m.assistant.expand}
        </button>
      ) : null}
    </div>
  );
}

export function RunStepsDialog({ run, open, onClose }: { run: RunStatusRow; open: boolean; onClose: () => void }) {
  const m = useMessages();
  const lang = useLang();
  const [lines, setLines] = useState<string[] | null>(null);
  const live = isLive(run.status);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const j = await getJson<{ lines: string[] }>(`/api/executor/log?id=${run.id}`);
        if (!cancelled) setLines(j.lines ?? []);
      } catch {
        // keep last known lines
      }
    };
    void load();
    if (!live) {
      return () => {
        cancelled = true;
      };
    }
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [open, run.id, live]);

  useEffect(() => {
    if (live) bottom.current?.scrollIntoView({ block: "end" });
  }, [lines, live]);

  const steps = useMemo(() => parseLog(lines ?? []), [lines]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={m.assistant.stepsTitle(run.id, labelOf(m.labels.runKind, run.kind, run.kind))}
      description={
        <>
          <Chip tone={RUN_STATUS_TONE[run.status] ?? "neutral"}>{labelOf(m.labels.runStatus, run.status, run.status)}</Chip>{" "}
          {describeRun(run.kind, run.options, lang)}
          {run.summary ? ` · ${run.summary}` : ""}
        </>
      }
    >
      {lines === null ? (
        <SkeletonRows rows={4} />
      ) : steps.length === 0 ? (
        <p className="muted">{m.assistant.noLogYet}</p>
      ) : (
        <ol className="timeline" aria-live={live ? "polite" : undefined}>
          {steps.map((s, i) => (
            <li key={i} className={cx("step", `step-${s.kind}`)}>
              <span className="step-at">{s.at ?? ""}</span>
              <span className="step-mark" aria-hidden />
              <span className="step-text">{s.text}</span>
            </li>
          ))}
          <div ref={bottom} />
        </ol>
      )}
    </Dialog>
  );
}

// Sidebar footer: one line on what the assistant is doing, linking to the 投递 page.
export function AssistantPill() {
  const m = useMessages();
  const { data } = useOverview();
  const run = data?.assistant ?? null;
  const live = !!run && isLive(run.status);
  const text =
    live && run ? m.assistant.pillLive(labelOf(m.labels.runKind, run.kind, run.kind), labelOf(m.labels.runStatus, run.status, run.status)) : m.assistant.pillIdle;
  return (
    <Link href="/apply" className={cx("assistant-pill", live && "is-live")} title={text}>
      <span className={cx("dot", run?.status === "running" && "is-running", run?.status === "queued" && "is-queued")} aria-hidden />
      <span className="truncate">{text}</span>
    </Link>
  );
}
