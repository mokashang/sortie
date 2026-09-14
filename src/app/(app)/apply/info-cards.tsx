"use client";
import { useCallback, useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { Button, Card, Checkbox, Chip, Field, Input, LinkButton, Section, Select, Tooltip, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";

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
        title: `已提交 ${row.company} 的答案`,
        description: j.status === "prepared" ? "助手会接着填这份表单。" : "已重新入队,下一次投递会带上这些答案。",
        tone: "good",
      });
      await refresh();
      await refreshOverview();
    } catch (e) {
      toast({ title: "提交失败", description: errorMessage(e), tone: "danger" });
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
              <Chip>{row.direction ? directionLabel(row.direction) : "未分类"}</Chip>
              {row.status === "needs_info" ? (
                <Chip tone="warn">助手等待中 · {row.askedAt}</Chip>
              ) : (
                <Chip tone="neutral" title={row.needsManualReason ?? undefined}>
                  助手已超时 · 补完后自动重新入队
                </Chip>
              )}
            </div>
          </div>
          {row.applyUrl ? (
            <LinkButton href={row.applyUrl} external size="sm" variant="ghost">
              看职位
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
                    {q.optional ? <span className="muted xs">(可选)</span> : null}
                    <Tooltip content={`答案会以「${q.key}」存进标准答案,下次自动填`} />
                  </>
                }
                hint={q.hint}
              >
                <div className="row row-nowrap">
                  {q.options && q.options.length > 0 ? (
                    <Select id={id} value={d.value} onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })} style={{ maxWidth: 360 }}>
                      <option value="">选择…</option>
                      {q.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input id={id} value={d.value} placeholder="你的答案" onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })} style={{ maxWidth: 480 }} />
                  )}
                  <Checkbox label="仅本次" checked={d.onlyOnce} onChange={(e) => setDraft(row.jobId, q.key, { onlyOnce: e.target.checked })} />
                </div>
              </Field>
            );
          })}
        </div>

        <div className="row mt-4">
          <Button variant="primary" onClick={() => submit(row)} loading={busyId === row.jobId} disabled={missing}>
            提交答案,继续投递
          </Button>
          {missing ? <span className="muted small">还有必填题没填。</span> : null}
        </div>
      </Card>
    );
  });

  if (compact) return <div className="col gap-3">{body}</div>;

  return (
    <Section title="待补信息" count={rows.length} description="助手填到一半遇到了标准答案里没有的题,正停在表单上等你。">
      <div className="col gap-3">{body}</div>
      <p className="muted xs mt-3">
        <MessageSquare size={12} aria-hidden /> 岗位特有的题勾「仅本次」,其余会存进档案的标准答案,下次不再问。
      </p>
    </Section>
  );
}
