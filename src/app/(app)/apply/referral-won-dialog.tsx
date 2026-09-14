"use client";
import { useEffect, useState } from "react";
import { postJson, errorMessage } from "@/app/lib/api";
import { Button, Dialog, Field, Input, Select, useToast } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";

export interface WonInitial {
  company: string;
  jobIds: number[];
  personName: string;
  source: string;
  link: string;
  code: string;
  note: string;
}

// 「有内推了」: record who referred you (and any link/code), then re-queue the jobs for applying.
export function ReferralWonDialog({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial: WonInitial | null; onSaved: () => Promise<void> | void }) {
  const m = useMessages();
  const [form, setForm] = useState<WonInitial | null>(initial);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  async function save() {
    if (!form || !form.personName.trim()) return;
    setBusy(true);
    try {
      const j = await postJson<{ autoStarted?: boolean; runId?: number; channel?: string; message?: string }>("/api/referral/decide", {
        jobIds: form.jobIds,
        action: "won",
        info: { source: form.source, link: form.link.trim() || undefined, code: form.code.trim() || undefined, note: form.note.trim() || undefined },
        personName: form.personName.trim(),
      });
      toast({
        title: m.apply.won.saved(form.company),
        description: j.autoStarted ? m.apply.won.savedQueued : m.apply.won.savedRequeued,
        tone: "good",
      });
      onClose();
      await onSaved();
    } catch (e) {
      toast({ title: m.apply.won.saveFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<WonInitial>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={m.apply.won.title(form?.company ?? "")}
      description={m.apply.won.description}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {m.common.cancel}
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form?.personName.trim()}>
            {m.apply.won.saveAndApply}
          </Button>
        </>
      }
    >
      {form ? (
        <div className="col gap-3">
          <Field label={m.apply.won.source} htmlFor="won-source">
            <Select id="won-source" value={form.source} onChange={(e) => set({ source: e.target.value })}>
              {Object.entries(m.labels.referralSource).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={m.apply.won.person} htmlFor="won-name">
            <Input id="won-name" value={form.personName} onChange={(e) => set({ personName: e.target.value })} placeholder={m.apply.won.personPlaceholder} autoFocus />
          </Field>
          <Field label={m.apply.won.link} hint={m.apply.won.linkHint} htmlFor="won-link">
            <Input id="won-link" value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label={m.apply.won.code} htmlFor="won-code">
            <Input id="won-code" value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder={m.apply.won.optionalPlaceholder} />
          </Field>
          <Field label={m.apply.won.note} htmlFor="won-note">
            <Input id="won-note" value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder={m.apply.won.optionalPlaceholder} />
          </Field>
        </div>
      ) : null}
    </Dialog>
  );
}
