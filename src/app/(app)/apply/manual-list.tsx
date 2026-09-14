"use client";
import { useState } from "react";
import { ExternalLink, RotateCcw, Trash } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { postJson, errorMessage } from "@/app/lib/api";
import { Button, Checkbox, Chip, ConfirmDialog, EmptyState, Menu, Tooltip, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";

export interface ManualRow {
  job_id: number;
  company: string;
  title: string;
  apply_url: string | null;
  needs_manual_reason: string;
  direction: string | null;
  updated_at: string; // local "MM-DD HH:MM"
}

// 需人工: applications the assistant (or a rejection) parked. Retry un-parks; remove archives
// (undoable from the toast, and from the queue's 全部入库 tab).
export function ManualList({ rows: initial }: { rows: ManualRow[] }) {
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmIds, setConfirmIds] = useState<number[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh: refreshOverview } = useOverview();
  const { toast } = useToast();

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function retry(row: ManualRow) {
    setBusy(true);
    try {
      await postJson("/api/apply/unpark", { jobId: row.job_id });
      setRows((prev) => prev.filter((r) => r.job_id !== row.job_id));
      toast({ title: `${row.company} 已放回队列`, description: "下次投递时会再试一次。", tone: "good" });
      await refreshOverview();
    } catch (e) {
      toast({ title: "重试失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(ids: number[]) {
    setBusy(true);
    const removed = rows.filter((r) => ids.includes(r.job_id));
    try {
      await postJson("/api/apply/archive-manual", { jobIds: ids });
      setRows((prev) => prev.filter((r) => !ids.includes(r.job_id)));
      setSelected(new Set());
      setConfirmIds(null);
      toast({
        title: removed.length === 1 ? `已移除 ${removed[0].company} · ${removed[0].title}` : `已移除 ${removed.length} 条`,
        description: "已归档,不再投递。",
        action: {
          label: "撤销",
          onClick: () => {
            Promise.all(ids.map((jobId) => postJson("/api/queue/unarchive", { jobId })))
              .then(() => {
                setRows((prev) => [...removed, ...prev]);
                toast({ title: "已恢复", tone: "good" });
              })
              .catch((e) => toast({ title: "撤销失败", description: errorMessage(e), tone: "danger" }));
          },
        },
      });
      await refreshOverview();
    } catch (e) {
      toast({ title: "移除失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return <EmptyState compact title="没有需要人工处理的申请" description="助手遇到登录墙、验证码或死链时,会把申请放到这里。" />;
  }

  return (
    <div>
      <div className="row mb-2">
        <Checkbox label="全选" checked={allSelected} disabled={busy} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.job_id)))} />
        <Button size="sm" variant="danger" icon={<Trash size={13} />} disabled={busy || selected.size === 0} onClick={() => setConfirmIds([...selected])}>
          移除所选({selected.size})
        </Button>
      </div>
      <div className="manual-list">
        {rows.map((r) => (
          <div key={r.job_id} className="manual-row">
            <Checkbox label={<span className="sr-only">选择 {r.company}</span>} checked={selected.has(r.job_id)} disabled={busy} onChange={() => toggle(r.job_id)} />
            <div className="grow">
              <div className="row">
                <span className="serif strong">{r.company}</span>
                <span className="muted">·</span>
                <span>{r.title}</span>
                <Chip outline>{r.direction ? directionLabel(r.direction) : "未分类"}</Chip>
              </div>
              <div className="muted small mt-1 row">
                <span className="truncate" style={{ maxWidth: 520 }} title={r.needs_manual_reason}>
                  {r.needs_manual_reason}
                </span>
                {r.needs_manual_reason.length > 80 ? <Tooltip content={r.needs_manual_reason} /> : null}
                <span className="mono xs">{r.updated_at}</span>
              </div>
            </div>
            <Menu
              label="操作"
              items={[
                ...(r.apply_url ? [{ label: "打开申请页", icon: <ExternalLink size={14} />, onSelect: () => window.open(r.apply_url!, "_blank", "noopener") }] : []),
                { label: "重试", icon: <RotateCcw size={14} />, onSelect: () => void retry(r), disabled: busy },
                "sep" as const,
                { label: "移除", icon: <Trash size={14} />, danger: true, onSelect: () => setConfirmIds([r.job_id]), disabled: busy },
              ]}
            />
          </div>
        ))}
      </div>
      <ConfirmDialog
        open={confirmIds !== null}
        onClose={() => setConfirmIds(null)}
        onConfirm={() => {
          if (confirmIds) void remove(confirmIds);
        }}
        busy={busy}
        danger
        title={confirmIds && confirmIds.length === 1 ? "移除这条申请?" : `移除这 ${confirmIds?.length ?? 0} 条申请?`}
        description="会归档、不再投递。移除后可以从提示里撤销,也能在职位页「全部入库」里找回。"
        confirmLabel="移除"
      />
    </div>
  );
}
