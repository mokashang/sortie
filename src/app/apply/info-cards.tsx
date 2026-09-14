"use client";
import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { directionName } from "@/app/lib/labels";
import { Button, Card, Checkbox, Chip, Field, Input, LinkButton, Section, Select, Tooltip, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { useLang, useMessages } from "@/i18n/client";

interface Question {
  key: string;
  label: string;
  hint?: string;
  options?: string[];
  optional?: boolean;
}

export interface InfoRow {
  jobId: number;
  company: string;
  title: string;
  applyUrl: string | null;
  direction: string | null;
  status: string; // 'needs_info' (assistant waiting on the form) | 'matched' (timed out; parked with the questions kept)
  needsManualReason: string | null;
  questions: Question[];
  askedAt: string;
}

type Draft = { value: string; onlyOnce: boolean };

// 待补信息: the assistant hit a required question the profile can't answer. Each card is a small
// form; answers are remembered as standard answers unless 「仅本次」 is ticked. Renders nothing
// when there is nothing to answer.
export function InfoCards({ compact = false }: { compact?: boolean }) {
  const m = useMessages();
  const lang = useLang();
  const [rows, setRows] = useState<InfoRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Record<string, Draft>>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const { refresh: refreshOverview } = useOverview();
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const j = await getJson<{ needsInfo: InfoRow[] }>("/api/apply/pending");
      setRows(j.needsInfo ?? []);
    } catch {
      // keep last known list
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  const draft = (jobId: number, key: string): Draft => drafts[jobId]?.[key] ?? { value: "", onlyOnce: false };
  function setDraft(jobId: number, key: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [jobId]: { ...(prev[jobId] ?? {}), [key]: { ...draft(jobId, key), ...patch } } }));
  }

  async function submit(row: InfoRow) {
    setBusyId(row.jobId);
    try {
      const answers: Record<string, { value: string; remember: boolean }> = {};
      for (const q of row.questions) {
        const d = draft(row.jobId, q.key);
        answers[q.key] = { value: d.value, remember: !d.onlyOnce };
      }
      const j = await postJson<{ status?: string }>("/api/apply/answer-info", { jobId: row.jobId, answers });
      toast({
        title: m.apply.info.submitted(row.company),
        description: j.status === "prepared" ? m.apply.info.submittedContinue : m.apply.info.submittedRequeued,
        tone: "good",
      });
      await refresh();
      await refreshOverview();
    } catch (e) {
      toast({ title: m.apply.info.submitFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return null;

  const body = rows.map((row) => {
    const missing = row.questions.some((q) => !q.optional && !draft(row.jobId, q.key).value.trim());
    return (
      <Card key={row.jobId} tone="warn" className="info-card">
        <div className="row between">
          <div className="grow">
            <div className="confirm-title">
              <span className="serif strong">{row.company}</span>
              <span className="muted"> · </span>
              <span>{row.title}</span>
            </div>
            <div className="row mt-2">
              <Chip>{directionName(row.direction, lang)}</Chip>
              {row.status === "needs_info" ? (
                <Chip tone="warn">{m.apply.info.waiting(row.askedAt)}</Chip>
              ) : (
                <Chip tone="neutral" title={row.needsManualReason ?? undefined}>
                  {m.apply.info.timedOut}
                </Chip>
              )}
            </div>
          </div>
          {row.applyUrl ? (
            <LinkButton href={row.applyUrl} external size="sm" variant="ghost">
              {m.apply.info.viewJob}
            </LinkButton>
          ) : null}
        </div>

        <div className="col gap-3 mt-4">
          {row.questions.map((q) => {
            const d = draft(row.jobId, q.key);
            const id = `info-${row.jobId}-${q.key}`;
            return (
              <Field
                key={q.key}
                htmlFor={id}
                label={
                  <>
                    {q.label}
                    {q.optional ? <span className="muted xs">{m.apply.info.optionalMark}</span> : null}
                    <Tooltip content={m.apply.info.rememberTip(q.key)} />
                  </>
                }
                hint={q.hint}
              >
                <div className="row row-nowrap">
                  {q.options && q.options.length > 0 ? (
                    <Select id={id} value={d.value} onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })} style={{ maxWidth: 360 }}>
                      <option value="">{m.apply.info.choose}</option>
                      {q.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input id={id} value={d.value} placeholder={m.apply.info.answerPlaceholder} onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })} style={{ maxWidth: 480 }} />
                  )}
                  <Checkbox label={m.apply.info.onlyOnce} checked={d.onlyOnce} onChange={(e) => setDraft(row.jobId, q.key, { onlyOnce: e.target.checked })} />
                </div>
              </Field>
            );
          })}
        </div>

        <div className="row mt-4">
          <Button variant="primary" onClick={() => submit(row)} loading={busyId === row.jobId} disabled={missing}>
            {m.apply.info.submitButton}
          </Button>
          {missing ? <span className="muted small">{m.apply.info.missingRequired}</span> : null}
        </div>
      </Card>
    );
  });

  if (compact) return <div className="col gap-3">{body}</div>;

  return (
    <Section title={m.apply.info.sectionTitle} count={rows.length} description={m.apply.info.sectionDescription}>
      <div className="col gap-3">{body}</div>
      <p className="muted xs mt-3">
        <MessageSquare size={12} aria-hidden /> {m.apply.info.footnote}
      </p>
    </Section>
  );
}
