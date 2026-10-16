"use client";
import { useState } from "react";
import { Play, RotateCcw, X } from "lucide-react";
import { directionName } from "@/app/lib/labels";
import { relativeTime } from "@/app/lib/time";
import { postJson, errorMessage } from "@/app/lib/api";
import { Button, Card, Chip, useToast } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";

// One task-level 待处理 card (src/apply/plan-alerts.ts): a plan that stopped short, or a task that
// gave up with jobs untouched. The assistant's last summary is shown as written — it is often
// the only explanation there is — and the card ends in a button either way.
export interface PlanAlertRow {
  runId: number;
  kind: "chain" | "failed";
  root: number;
  reason: "no_progress" | "too_long" | "failed";
  endedAt: string | null;
  planned: { direct: number; referral: number } | null;
  achieved: { direct: number; referral: number } | null;
  remaining: { direction: string; count: number; mode: "direct" | "referral" }[];
  untouched: number[];
  total: number;
  mode: "direct" | "referral";
  summary: string | null;
}

// ended_at is SQLite UTC text ("2026-10-16 08:53:09").
const utcIso = (s: string | null) => (s ? `${s.replace(" ", "T")}Z` : null);

export function PlanAlertCard({ alert, busy, setBusy, onDone }: { alert: PlanAlertRow; busy: string | null; setBusy: (k: string | null) => void; onDone: () => Promise<void> }) {
  const m = useMessages();
  const lang = useLang();
  const t = m.apply.todo.plan;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  async function act(action: "continue" | "dismiss") {
    const key = `plan-${action}-${alert.runId}`;
    setBusy(key);
    try {
      const j = await postJson<{ runId: number | null }>("/api/apply/plan-alerts", { runId: alert.runId, action });
      toast({ title: action === "continue" && j.runId ? t.continued(j.runId) : t.dismissed, tone: "good" });
      await onDone();
    } catch (e) {
      toast({ title: t.failed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  const title = alert.kind === "chain" ? t.chainTitle(alert.root) : t.failedTitle(alert.runId);
  const why = alert.reason === "no_progress" ? t.noProgress : alert.reason === "too_long" ? t.tooLong : t.untouched(alert.untouched.length, alert.total);
  const progress =
    alert.planned && alert.achieved
      ? [
          alert.planned.direct > 0 ? `${t.direct} ${alert.achieved.direct}/${alert.planned.direct}` : null,
          alert.planned.referral > 0 ? `${t.referral} ${alert.achieved.referral}/${alert.planned.referral}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  const remaining = alert.remaining.map((e) => `${directionName(e.direction, lang)} ${e.mode === "referral" ? t.referral : t.direct} ${e.count}`).join(" · ");
  const continueKey = `plan-continue-${alert.runId}`;
  const dismissKey = `plan-dismiss-${alert.runId}`;
  const long = (alert.summary ?? "").length > 220;

  return (
    <Card tone="warn" className="todo-card">
      <div className="confirm-title">
        <span className="serif strong">{title}</span>
      </div>
      <div className="row mt-2">
        <Chip tone="accent">{t.kind}</Chip>
        {progress ? <Chip outline>{progress}</Chip> : null}
        {alert.endedAt ? <Chip tone="neutral">{relativeTime(utcIso(alert.endedAt), lang)}</Chip> : null}
      </div>
      <p className="small mt-3">{why}</p>
      {remaining ? (
        <p className="muted small mt-2">
          {t.remaining}: {remaining}
        </p>
      ) : null}
      {alert.summary ? (
        <div className="mt-3">
          <div className="muted xs">{t.lastSaid}</div>
          <p className={`small todo-hint${long && !open ? " is-clamped" : ""}`} onClick={() => long && setOpen((v) => !v)}>
            {alert.summary}
          </p>
        </div>
      ) : null}
      <div className="row mt-4">
        <Button
          variant="primary"
          icon={alert.kind === "chain" ? <Play size={14} /> : <RotateCcw size={14} />}
          onClick={() => act("continue")}
          loading={busy === continueKey}
          disabled={busy !== null && busy !== continueKey}
        >
          {alert.kind === "chain" ? t.continue : t.retry}
        </Button>
        <Button variant="ghost" size="sm" icon={<X size={13} />} onClick={() => act("dismiss")} loading={busy === dismissKey} disabled={busy !== null && busy !== dismissKey}>
          {t.dismiss}
        </Button>
      </div>
    </Card>
  );
}
