"use client";
import { useState } from "react";
import { Plus, Trash } from "lucide-react";
import { putJson, errorMessage } from "@/app/lib/api";
import { ANSWER_LABELS, answerHint, answerLabel } from "@/app/lib/answer-labels";
import { Button, EmptyState, Field, IconButton, Input, Tooltip, useToast } from "@/app/components/ui";

interface Row {
  key: string;
  value: string;
  custom: boolean;
}

// 标准答案: what the assistant fills when a form asks something beyond contact / education /
// work authorization / EEO. Known keys get friendly labels; anything else is a custom key.
export function AnswersTab({ initial }: { initial: Record<string, string> }) {
  const [rows, setRows] = useState<Row[]>(Object.entries(initial).map(([key, value]) => ({ key, value, custom: !(key in ANSWER_LABELS) })));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { toast } = useToast();

  const existing = new Set(rows.map((r) => r.key));
  const suggestions = Object.keys(ANSWER_LABELS).filter((k) => !existing.has(k));

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setDirty(true);
  }
  function add(key = "", custom = false) {
    if (key && existing.has(key)) return;
    setRows((prev) => [...prev, { key, value: "", custom }]);
    setDirty(true);
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    try {
      const answers: Record<string, string> = {};
      for (const r of rows) if (r.key.trim()) answers[r.key.trim()] = r.value;
      const j = await putJson<{ answers?: Record<string, string> }>("/api/profile/standard-answers", { answers });
      const saved = j.answers ?? answers;
      setRows(Object.entries(saved).map(([key, value]) => ({ key, value: String(value), custom: !(key in ANSWER_LABELS) })));
      setDirty(false);
      toast({ title: "标准答案已保存", description: "下一次填表即生效。", tone: "good" });
    } catch (e) {
      toast({ title: "保存失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted small mb-4">
        助手填表时,联系方式、教育、工作授权和 EEO 之外的问题都从这里取。遇到这里没有的必填题,它会停下来在投递页「待处理」里问你,答案默认也存进这里。
      </p>

      {rows.length === 0 ? (
        <EmptyState compact title="还没有标准答案" description="从下面的常见问题里加几条,或自定义。" />
      ) : (
        <div className="col gap-3">
          {rows.map((r, i) => (
            <div key={i} className="answer-row">
              {r.custom ? (
                <Field label="问题键名" hint="英文小写加下划线,助手按它匹配表单题" htmlFor={`ak-${i}`}>
                  <Input id={`ak-${i}`} className="mono" value={r.key} onChange={(e) => update(i, { key: e.target.value })} placeholder="如 preferred_office" />
                </Field>
              ) : (
                <div className="field">
                  <div className="field-label">
                    {answerLabel(r.key)}
                    <Tooltip content={`键名 ${r.key}`} />
                  </div>
                  <div className="field-hint">{answerHint(r.key) ?? r.key}</div>
                </div>
              )}
              <Field label="答案" htmlFor={`av-${i}`}>
                <Input id={`av-${i}`} value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder="答案" />
              </Field>
              <IconButton label="删除" icon={<Trash size={14} />} onClick={() => remove(i)} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="field-label">常见问题</div>
        <div className="row mt-2">
          {suggestions.map((k) => (
            <Button key={k} size="sm" variant="ghost" icon={<Plus size={12} />} title={answerHint(k)} onClick={() => add(k)}>
              {answerLabel(k)}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => add("", true)}>
            自定义问题
          </Button>
        </div>
      </div>

      <div className="row mt-6">
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty}>
          保存
        </Button>
        {dirty ? <span className="muted small">有未保存的修改。</span> : null}
      </div>
    </div>
  );
}
