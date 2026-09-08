"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ListChecks, Square } from "lucide-react";
import type { RunStatusRow } from "@/executor/runner";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { RUN_STATUS_LABEL, RUN_STATUS_TONE, RUN_KIND_LABEL, CHANNEL_LABEL, labelOf } from "@/app/lib/labels";
import { describeRun } from "@/app/lib/describe-run";
import { parseLog, parseLogLine } from "@/app/lib/log-steps";
import { localShort } from "@/app/lib/time";
import { cx } from "@/app/lib/cx";
import { Button, Card, Chip, ConfirmDialog, Dialog, RelativeTime, SkeletonRows, useToast } from "@/app/components/ui";
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
      toast({ title: `已停止任务 #${stopFor.id}`, tone: "neutral" });
      setStopFor(null);
      await refresh();
      await refreshOverview();
    } catch (e) {
      toast({ title: "停止失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setStopping(false);
    }
  }

  const statusChip = run ? (
    <Chip tone={RUN_STATUS_TONE[run.status] ?? "neutral"}>{labelOf(RUN_STATUS_LABEL, run.status, run.status)}</Chip>
  ) : (
    <Chip>空闲</Chip>
  );

  return (
    <>
      <Card className={cx("assistant-card", variant === "compact" && "assistant-compact")}>
        <div className="assistant-head">
          <div className="assistant-name">
            <span className={cx("dot", run?.status === "running" && "is-running", run?.status === "queued" && "is-queued")} aria-hidden />
            <Bot size={16} aria-hidden />
            <span>助手</span>
            {statusChip}
            {run ? (
              <span className="muted small">
                {labelOf(RUN_KIND_LABEL, run.kind, run.kind)}
                {describeRun(run.kind, run.options) ? ` · ${describeRun(run.kind, run.options)}` : ""}
              </span>
            ) : null}
          </div>
          <div className="row">
            {actions}
            {run ? (
              <Button size="sm" variant="ghost" icon={<ListChecks size={14} />} onClick={() => setStepsFor(run)}>
                查看步骤
              </Button>
            ) : null}
            {live ? (
              <Button size="sm" variant="danger" icon={<Square size={12} />} onClick={() => setStopFor(run)}>
                停止
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
                已排队 · {labelOf(CHANNEL_LABEL, run.channel, run.channel)}操作,助手接手后开始
                {run.channel === "user_chrome" ? <span className="muted"> · 桌面应用里的会话在线时由它接手,否则 App 自动拉起一个</span> : null}
              </p>
            ) : (
              <div className="assistant-last">
                <span className="muted small nowrap">最近一步</span>
                <span>{lastLine?.text ?? "已开始,等待第一步…"}</span>
              </div>
            )}
            <p className="muted xs mt-2">
              开始于 <RelativeTime value={run.startedAt} /> · 任务 #{run.id}
            </p>
          </div>
        ) : (
          <div className="assistant-body muted small">
            {run ? (
              <>
                上次:{labelOf(RUN_KIND_LABEL, run.kind, run.kind)} · {labelOf(RUN_STATUS_LABEL, run.status, run.status)} ·{" "}
                <RelativeTime value={run.endedAt ?? run.startedAt} />
                {run.summary ? <span className="assistant-summary"> · {run.summary}</span> : null}
              </>
            ) : (
              "还没有执行过任务。"
            )}
          </div>
        )}

        {variant === "full" && relevant.length > 0 ? (
          <details className="assistant-history">
            <summary>任务记录(最近 {relevant.length} 次)</summary>
            <div className="table-scroll mt-2">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>类型</th>
                    <th>内容</th>
                    <th>状态</th>
                    <th>开始</th>
                    <th>结束</th>
                    <th>结果</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {relevant.map((r) => (
                    <tr key={r.id}>
                      <td className="mono muted">{r.id}</td>
                      <td>{labelOf(RUN_KIND_LABEL, r.kind, r.kind)}</td>
                      <td className="muted small">{describeRun(r.kind, r.options) || labelOf(CHANNEL_LABEL, r.channel, r.channel)}</td>
                      <td>
                        <Chip tone={RUN_STATUS_TONE[r.status] ?? "neutral"}>{labelOf(RUN_STATUS_LABEL, r.status, r.status)}</Chip>
                      </td>
                      <td className="mono muted small nowrap">{localShort(r.startedAt)}</td>
                      <td className="mono muted small nowrap">{localShort(r.endedAt)}</td>
                      <td className="muted small" style={{ maxWidth: 320 }}>{r.summary ?? ""}</td>
                      <td>
                        <Button size="sm" variant="ghost" onClick={() => setStepsFor(r)}>
                          步骤
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
        title="停止这个任务?"
        description="助手会在当前步骤停下;已经填好、还没提交的申请会留在待确认里。"
        confirmLabel="停止"
      />
    </>
  );
}

export function RunStepsDialog({ run, open, onClose }: { run: RunStatusRow; open: boolean; onClose: () => void }) {
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
      title={`任务 #${run.id} · ${labelOf(RUN_KIND_LABEL, run.kind, run.kind)}`}
      description={
        <>
          <Chip tone={RUN_STATUS_TONE[run.status] ?? "neutral"}>{labelOf(RUN_STATUS_LABEL, run.status, run.status)}</Chip>{" "}
          {describeRun(run.kind, run.options)}
          {run.summary ? ` · ${run.summary}` : ""}
        </>
      }
    >
      {lines === null ? (
        <SkeletonRows rows={4} />
      ) : steps.length === 0 ? (
        <p className="muted">还没有记录。</p>
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
  const { data } = useOverview();
  const run = data?.assistant ?? null;
  const live = !!run && isLive(run.status);
  const text = live && run ? `助手 · ${labelOf(RUN_STATUS_LABEL, run.status, run.status)} · ${labelOf(RUN_KIND_LABEL, run.kind, run.kind)}` : "助手空闲";
  return (
    <Link href="/apply" className="assistant-pill" title={text}>
      <span className={cx("dot", run?.status === "running" && "is-running", run?.status === "queued" && "is-queued")} aria-hidden />
      <span className="truncate">{text}</span>
    </Link>
  );
}
