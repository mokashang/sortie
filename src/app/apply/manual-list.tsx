"use client";
import { useState } from "react";
import { ExternalLink, RotateCcw, Trash } from "lucide-react";
import { postJson, errorMessage } from "@/app/lib/api";
import { directionName } from "@/app/lib/labels";
import { Button, Checkbox, Chip, ConfirmDialog, EmptyState, Menu, Tooltip, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { useLang, useMessages } from "@/i18n/client";

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
  const m = useMessages();
  const lang = useLang();
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
      toast({ title: m.apply.manual.retried(row.company), description: m.apply.manual.retriedDescription, tone: "good" });
      await refreshOverview();
    } catch (e) {
      toast({ title: m.apply.manual.retryFailed, description: errorMessage(e), tone: "danger" });
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
        title: removed.length === 1 ? m.apply.manual.removedOne(removed[0].company, removed[0].title) : m.apply.manual.removedMany(removed.length),
        description: m.apply.manual.removedDescription,
        action: {
          label: m.common.undo,
          onClick: () => {
            Promise.all(ids.map((jobId) => postJson("/api/queue/unarchive", { jobId })))
              .then(() => {
                setRows((prev) => [...removed, ...prev]);
                toast({ title: m.apply.manual.restored, tone: "good" });
              })
              .catch((e) => toast({ title: m.apply.manual.undoFailed, description: errorMessage(e), tone: "danger" }));
          },
        },
      });
      await refreshOverview();
    } catch (e) {
      toast({ title: m.apply.manual.removeFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) {
    return <EmptyState compact title={m.apply.manual.emptyTitle} description={m.apply.manual.emptyDescription} />;
  }

  return (
    <div>
      <div className="row mb-2">
        <Checkbox label={m.apply.manual.selectAll} checked={allSelected} disabled={busy} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.job_id)))} />
        <Button size="sm" variant="danger" icon={<Trash size={13} />} disabled={busy || selected.size === 0} onClick={() => setConfirmIds([...selected])}>
          {m.apply.manual.removeSelected(selected.size)}
        </Button>
      </div>
      <div className="manual-list">
        {rows.map((r) => (
          <div key={r.job_id} className="manual-row">
            <Checkbox label={<span className="sr-only">{m.apply.manual.selectRow(r.company)}</span>} checked={selected.has(r.job_id)} disabled={busy} onChange={() => toggle(r.job_id)} />
            <div className="grow">
              <div className="row">
                <span className="serif strong">{r.company}</span>
                <span className="muted">·</span>
                <span>{r.title}</span>
                <Chip outline>{directionName(r.direction, lang)}</Chip>
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
              label={m.apply.manual.actions}
              items={[
                ...(r.apply_url ? [{ label: m.apply.manual.openApplyPage, icon: <ExternalLink size={14} />, onSelect: () => window.open(r.apply_url!, "_blank", "noopener") }] : []),
                { label: m.common.retry, icon: <RotateCcw size={14} />, onSelect: () => void retry(r), disabled: busy },
                "sep" as const,
                { label: m.common.remove, icon: <Trash size={14} />, danger: true, onSelect: () => setConfirmIds([r.job_id]), disabled: busy },
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
        title={m.apply.manual.confirmRemoveTitle(confirmIds?.length ?? 0)}
        description={m.apply.manual.confirmRemoveDescription}
        confirmLabel={m.common.remove}
      />
    </div>
  );
}
