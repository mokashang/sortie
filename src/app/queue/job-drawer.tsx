"use client";
import { X } from "lucide-react";
import { Drawer, IconButton } from "@/app/components/ui";
import { isInQueue, type JobRowData, type RowHandlers } from "./job-row";
import { DetailBody, DetailFooter, DetailHead, useJobDetail } from "./job-detail";

export interface JobDetailProps extends RowHandlers {
  row: JobRowData | null;
  rows: JobRowData[];
  allTab: boolean;
  busy: boolean;
  onNavigate: (id: number) => void;
  onClose: () => void;
}

// Phone / narrow window: the detail as a right-hand sheet.
export function JobDrawer({ row, rows, allTab, busy, onNavigate, onClose, onPin, onMode, onSkip }: JobDetailProps) {
  const state = useJobDetail(row?.id ?? null);
  const inQueue = row ? isInQueue(row, allTab) : false;
  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      title={row?.company ?? ""}
      subtitle={row?.title}
      headExtra={row ? <DetailHead row={row} allTab={allTab} /> : null}
      footer={row ? <DetailFooter row={row} rows={rows} inQueue={inQueue} busy={busy} onNavigate={onNavigate} onPin={onPin} onSkip={onSkip} /> : null}
    >
      {row ? <DetailBody state={state} row={row} allTab={allTab} busy={busy} onMode={onMode} /> : null}
    </Drawer>
  );
}

// Wide window: the same detail pinned beside the list, so the list stays in view.
export function JobPanel({ row, rows, allTab, busy, onNavigate, onClose, onPin, onMode, onSkip }: JobDetailProps) {
  const state = useJobDetail(row?.id ?? null);
  if (!row) return null;
  const inQueue = isInQueue(row, allTab);
  return (
    <aside className="queue-panel" aria-label={`${row.company} · ${row.title}`}>
      <div className="drawer-head">
        <div className="grow">
          <div className="drawer-title">{row.company}</div>
          <div className="drawer-subtitle">{row.title}</div>
          <div className="mt-2">
            <DetailHead row={row} allTab={allTab} />
          </div>
        </div>
        <IconButton label="关闭" icon={<X size={16} />} onClick={onClose} />
      </div>
      <div className="drawer-body">
        <DetailBody state={state} row={row} allTab={allTab} busy={busy} onMode={onMode} />
      </div>
      <div className="drawer-foot">
        <DetailFooter row={row} rows={rows} inQueue={inQueue} busy={busy} onNavigate={onNavigate} onPin={onPin} onSkip={onSkip} />
      </div>
    </aside>
  );
}
