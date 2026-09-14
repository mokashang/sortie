"use client";
import { useEffect, useState } from "react";
import { postJson, errorMessage } from "@/app/lib/api";
import { REFERRAL_SOURCE_LABEL } from "@/app/lib/labels";
import { Button, Dialog, Field, Input, Select, useToast } from "@/app/components/ui";

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
        title: `已记录 ${form.company} 的内推`,
        description: j.autoStarted ? "已排队投递任务,助手接手后开始填表。" : "岗位已重新入队,下次投递会带上内推信息。",
        tone: "good",
      });
      onClose();
      await onSaved();
    } catch (e) {
      toast({ title: "保存失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<WonInitial>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`有内推了 · ${form?.company ?? ""}`}
      description="记下推荐人和链接或推荐码,助手投递时会用上。"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form?.personName.trim()}>
            保存并开始投
          </Button>
        </>
      }
    >
      {form ? (
        <div className="col gap-3">
          <Field label="来源" htmlFor="won-source">
            <Select id="won-source" value={form.source} onChange={(e) => set({ source: e.target.value })}>
              {Object.entries(REFERRAL_SOURCE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="推荐人" htmlFor="won-name">
            <Input id="won-name" value={form.personName} onChange={(e) => set({ personName: e.target.value })} placeholder="对方姓名" autoFocus />
          </Field>
          <Field label="推荐链接" hint="有链接的话,助手会用它打开申请页" htmlFor="won-link">
            <Input id="won-link" value={form.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="推荐码" htmlFor="won-code">
            <Input id="won-code" value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder="可选" />
          </Field>
          <Field label="备注" htmlFor="won-note">
            <Input id="won-note" value={form.note} onChange={(e) => set({ note: e.target.value })} placeholder="可选" />
          </Field>
        </div>
      ) : null}
    </Dialog>
  );
}
