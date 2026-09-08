"use client";
import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Info } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { tierLabel } from "@/app/lib/labels";
import { Button, Card, Chip, EmptyState, PromptDialog, SkeletonCard, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";

export interface PendingRow {
  jobId: number;
  company: string;
  title: string;
  direction: string | null;
  tier: number | null;
  score: number | null;
  filledFields: Record<string, string>;
  resumeVersion: string | null;
  decision: string | null;
  referralPersonName: string | null;
}

// filledFields round-trips through unvalidated JSON from the assistant's report; String() never
// throws, so one odd value can't take the whole approval UI down.
function renderValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return String(value);
  } catch {
    return "";
  }
}

function LongText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (text.length <= 180) return <>{text}</>;
  return (
    <>
      {open ? text : `${text.slice(0, 180)}…`}{" "}
      <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)}>
        {open ? "收起" : "展开"}
      </button>
    </>
  );
}

// The confirmation inbox: every application the assistant filled and is holding before Submit.
// Polls every 3s so a card leaves on its own once it is submitted or decided elsewhere.
export function ConfirmCards({ compact = false }: { compact?: boolean }) {
  const [rows, setRows] = useState<PendingRow[] | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectFor, setRejectFor] = useState<PendingRow | null>(null);
  const { data, refresh: refreshOverview } = useOverview();
  const { toast } = useToast();
  const applyLive = data?.liveKinds.includes("apply") ?? false;

  const refresh = useCallback(async () => {
    try {
      const j = await getJson<{ pending: PendingRow[] }>("/api/apply/pending");
      setRows(j.pending ?? []);
    } catch {
      // transient — keep the last known list
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  async function decide(row: PendingRow, decision: "approve" | "reject", reason?: string) {
    setBusyId(row.jobId);
    try {
      const j = await postJson<{ autoStarted?: boolean; runId?: number; channel?: string }>("/api/apply/decide", {
        jobId: row.jobId,
        decision,
        reason: reason || undefined,
      });
      if (decision === "approve") {
        toast({
          title: `已批准 ${row.company}`,
          description: j.autoStarted
            ? j.channel === "user_chrome"
              ? "已排队一个提交任务,助手接手后提交。"
              : "已启动后台任务完成提交。"
            : "助手会接着提交。",
          tone: "good",
        });
      } else {
        toast({ title: `已拒绝 ${row.company}`, description: "申请已退回队列。", tone: "neutral" });
      }
      setRejectFor(null);
      await refresh();
      await refreshOverview();
    } catch (e) {
      toast({ title: "操作失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  if (rows === null) return compact ? null : <SkeletonCard />;

  if (rows.length === 0) {
    if (compact) return null;
    return <EmptyState compact icon={<CircleCheck size={24} />} title="没有等待确认的申请" description="助手填好表单后,会在这里停下等你确认,再点提交。" />;
  }

  return (
    <div className="col gap-3">
      {!applyLive ? (
        <div className="notice notice-info">
          <Info size={15} aria-hidden />
          <span>助手当前空闲。点「确认提交」后会自动排一个提交任务,助手接手后再点提交。</span>
        </div>
      ) : null}
      {rows.map((r) => {
        const approved = r.decision === "approved";
        const entries = Object.entries(r.filledFields ?? {});
        return (
          <Card key={r.jobId} tone={approved ? "good" : "default"} className="confirm-card">
            <div className="confirm-head">
              <div className="grow">
                <div className="confirm-title">
                  <span className="serif strong">{r.company}</span>
                  <span className="muted"> · </span>
                  <span>{r.title}</span>
                </div>
                <div className="row mt-2">
                  <Chip>{r.direction ? directionLabel(r.direction) : "未分类"}</Chip>
                  <Chip outline>{tierLabel(r.tier)}</Chip>
                  <span className="muted small">
                    分 <span className="mono">{r.score ?? "—"}</span>
                  </span>
                  {r.referralPersonName ? <Chip tone="good">带内推 · {r.referralPersonName}</Chip> : null}
                  <span className="muted small">简历版本 {r.resumeVersion ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className="table-scroll mt-3">
              <table className="kv-table">
                <tbody>
                  {entries.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        助手没有回报任何字段。
                      </td>
                    </tr>
                  ) : (
                    entries.map(([field, value]) => (
                      <tr key={field}>
                        <td>{field}</td>
                        <td>
                          <LongText text={renderValue(value)} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="row mt-4">
              {approved ? (
                <>
                  <Chip tone="good" icon={<CircleCheck size={12} />} size="md">
                    已批准 · 等助手提交
                  </Chip>
                  <span className="muted small">要撤回,请在助手提交前告诉它;提交后在「历史」里记录。</span>
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={() => decide(r, "approve")} loading={busyId === r.jobId}>
                    确认提交
                  </Button>
                  <Button variant="ghost" onClick={() => setRejectFor(r)} disabled={busyId === r.jobId}>
                    拒绝…
                  </Button>
                </>
              )}
            </div>
          </Card>
        );
      })}

      <PromptDialog
        open={rejectFor !== null}
        onClose={() => setRejectFor(null)}
        onSubmit={(reason) => {
          if (rejectFor) void decide(rejectFor, "reject", reason);
        }}
        busy={rejectFor !== null && busyId === rejectFor.jobId}
        title={rejectFor ? `拒绝 ${rejectFor.company} 的这份申请?` : "拒绝"}
        description="申请会退回队列,不会提交。"
        label="原因"
        placeholder="例如:地点不对 / 填错了要重填"
        submitLabel="拒绝并退回"
      />
    </div>
  );
}
