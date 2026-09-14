"use client";
import { useState } from "react";
import { Plus, Trash } from "lucide-react";
import { putJson, errorMessage } from "@/app/lib/api";
import { ANSWER_KEYS, answerHint, answerLabel } from "@/app/lib/answer-labels";
import { Button, EmptyState, Field, IconButton, Input, Tooltip, useToast } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";

interface Row {
  key: string;
  value: string;
  custom: boolean;
}

// The keys that have a friendly label; anything else the user typed is a custom key.
const KNOWN_KEYS = new Set<string>(ANSWER_KEYS);

// 标准答案: what the assistant fills when a form asks something beyond contact / education /
// work authorization / EEO. Known keys get friendly labels; anything else is a custom key.
export function AnswersTab({ initial }: { initial: Record<string, string> }) {
  const m = useMessages();
  const lang = useLang();
  const [rows, setRows] = useState<Row[]>(Object.entries(initial).map(([key, value]) => ({ key, value, custom: !KNOWN_KEYS.has(key) })));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const { toast } = useToast();

  const existing = new Set(rows.map((r) => r.key));
  const suggestions = ANSWER_KEYS.filter((k) => !existing.has(k));

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
      setRows(Object.entries(saved).map(([key, value]) => ({ key, value: String(value), custom: !KNOWN_KEYS.has(key) })));
      setDirty(false);
      toast({ title: m.profile.answers.saved, description: m.profile.answers.savedDescription, tone: "good" });
    } catch (e) {
      toast({ title: m.profile.answers.saveFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="muted small mb-4">{m.profile.answers.intro}</p>

      {rows.length === 0 ? (
        <EmptyState compact title={m.profile.answers.emptyTitle} description={m.profile.answers.emptyDescription} />
      ) : (
        <div className="col gap-3">
          {rows.map((r, i) => (
            <div key={i} className="answer-row">
              {r.custom ? (
                <Field label={m.profile.answers.keyLabel} hint={m.profile.answers.keyHint} htmlFor={`ak-${i}`}>
                  <Input id={`ak-${i}`} className="mono" value={r.key} onChange={(e) => update(i, { key: e.target.value })} placeholder={m.profile.answers.keyPlaceholder} />
                </Field>
              ) : (
                <div className="field">
                  <div className="field-label">
                    {answerLabel(r.key, lang)}
                    <Tooltip content={m.profile.answers.keyTooltip(r.key)} />
                  </div>
                  <div className="field-hint">{answerHint(r.key, lang) ?? r.key}</div>
                </div>
              )}
              <Field label={m.profile.answers.answer} htmlFor={`av-${i}`}>
                <Input id={`av-${i}`} value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder={m.profile.answers.answer} />
              </Field>
              <IconButton label={m.common.delete} icon={<Trash size={14} />} onClick={() => remove(i)} />
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <div className="field-label">{m.profile.answers.commonQuestions}</div>
        <div className="row mt-2">
          {suggestions.map((k) => (
            <Button key={k} size="sm" variant="ghost" icon={<Plus size={12} />} title={answerHint(k, lang)} onClick={() => add(k)}>
              {answerLabel(k, lang)}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon={<Plus size={12} />} onClick={() => add("", true)}>
            {m.profile.answers.customQuestion}
          </Button>
        </div>
      </div>

      <div className="row mt-6">
        <Button variant="primary" onClick={save} loading={busy} disabled={!dirty}>
          {m.common.save}
        </Button>
        {dirty ? <span className="muted small">{m.profile.answers.unsaved}</span> : null}
      </div>
    </div>
  );
}
