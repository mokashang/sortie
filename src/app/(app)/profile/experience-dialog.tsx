"use client";
import { useEffect, useState } from "react";
import { Plus, Trash, X } from "lucide-react";
import { DIRECTIONS, directionLabel } from "@/matcher/directions";
import { postJson, putJson, errorMessage } from "@/app/lib/api";
import { EXPERIENCE_KIND_LABEL } from "@/app/lib/labels";
import { Button, Chip, Dialog, Field, IconButton, Input, Menu, Select, Textarea, useToast } from "@/app/components/ui";
import { EXPERIENCE_KINDS, type Bullet, type Exp } from "./profile-types";

const blank = (): Exp => ({ kind: "work", title: "", organization: "", location: "", start_date: "", end_date: "", bullets: [], sort_order: 0 });

// Add / edit one experience: the fields, plus bullets that can each be tagged with the
// directions they apply to (the resume generator picks bullets by direction).
export function ExperienceDialog({ open, initial, onClose, onSaved }: { open: boolean; initial: Exp | null; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const [form, setForm] = useState<Exp>(blank());
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) setForm(initial ? { ...initial, bullets: initial.bullets.map((b) => ({ text: b.text, directions: [...(b.directions ?? [])] })) } : blank());
  }, [open, initial]);

  const set = (patch: Partial<Exp>) => setForm((f) => ({ ...f, ...patch }));
  const setBullet = (i: number, patch: Partial<Bullet>) => setForm((f) => ({ ...f, bullets: f.bullets.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const toggleDirection = (i: number, d: string) =>
    setForm((f) => ({
      ...f,
      bullets: f.bullets.map((b, j) => (j === i ? { ...b, directions: b.directions.includes(d) ? b.directions.filter((x) => x !== d) : [...b.directions, d] } : b)),
    }));

  async function save() {
    if (!form.title.trim()) return;
    setBusy(true);
    const payload = {
      kind: form.kind,
      title: form.title.trim(),
      organization: form.organization?.trim() || null,
      location: form.location?.trim() || null,
      start_date: form.start_date?.trim() || null,
      end_date: form.end_date?.trim() || null,
      bullets: form.bullets.filter((b) => b.text.trim()).map((b) => ({ text: b.text.trim(), directions: b.directions })),
      sort_order: form.sort_order ?? 0,
    };
    try {
      if (form.id) await putJson(`/api/experiences/${form.id}`, payload);
      else await postJson("/api/experiences", payload);
      toast({ title: form.id ? `已更新「${payload.title}」` : `已添加「${payload.title}」`, tone: "good" });
      onClose();
      await onSaved();
    } catch (e) {
      toast({ title: "保存失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={form.id ? "编辑经历" : "添加经历"}
      description="标题是职位、项目名或学位;要点写成简历上的一行,并标注它适用的方向。"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form.title.trim()}>
            保存
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <div className="form-grid">
          <Field label="类型" htmlFor="exp-kind">
            <Select id="exp-kind" value={form.kind} onChange={(e) => set({ kind: e.target.value })}>
              {EXPERIENCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {EXPERIENCE_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="标题" htmlFor="exp-title">
            <Input id="exp-title" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="职位 / 项目 / 学位" autoFocus />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="机构" htmlFor="exp-org">
            <Input id="exp-org" value={form.organization ?? ""} onChange={(e) => set({ organization: e.target.value })} placeholder="公司 / 学校 / 团队" />
          </Field>
          <Field label="地点" htmlFor="exp-loc">
            <Input id="exp-loc" value={form.location ?? ""} onChange={(e) => set({ location: e.target.value })} placeholder="Los Angeles, CA" />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="开始" hint="如 2025-06" htmlFor="exp-start">
            <Input id="exp-start" value={form.start_date ?? ""} onChange={(e) => set({ start_date: e.target.value })} placeholder="2025-06" />
          </Field>
          <Field label="结束" hint="在职 / 在读写 Present" htmlFor="exp-end">
            <Input id="exp-end" value={form.end_date ?? ""} onChange={(e) => set({ end_date: e.target.value })} placeholder="Present" />
          </Field>
        </div>

        <div>
          <div className="field-label">要点</div>
          <div className="col gap-3 mt-2">
            {form.bullets.map((b, i) => (
              <div key={i} className="bullet-editor">
                <div className="row row-nowrap" style={{ alignItems: "flex-start" }}>
                  <Textarea rows={2} autoGrow value={b.text} onChange={(e) => setBullet(i, { text: e.target.value })} placeholder={`要点 ${i + 1}`} aria-label={`要点 ${i + 1}`} />
                  <IconButton label="删除要点" icon={<Trash size={14} />} onClick={() => set({ bullets: form.bullets.filter((_, j) => j !== i) })} />
                </div>
                <div className="row mt-1">
                  {b.directions.map((d) => (
                    <button key={d} type="button" className="chip chip-outline chip-accent chip-btn" onClick={() => toggleDirection(i, d)} aria-label={`移除方向 ${directionLabel(d)}`}>
                      {directionLabel(d)} <X size={10} aria-hidden />
                    </button>
                  ))}
                  <Menu
                    text="＋ 方向"
                    size="sm"
                    align="start"
                    items={Object.keys(DIRECTIONS).map((d) => ({
                      label: `${b.directions.includes(d) ? "✓ " : ""}${directionLabel(d)}`,
                      onSelect: () => toggleDirection(i, d),
                    }))}
                  />
                  {b.directions.length === 0 ? <span className="muted xs">不标方向 = 所有方向都可用</span> : null}
                </div>
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => set({ bullets: [...form.bullets, { text: "", directions: [] }] })}>
                添加要点
              </Button>
            </div>
          </div>
        </div>
        {form.bullets.length === 0 ? <Chip outline>技能类经历可以不写要点</Chip> : null}
      </div>
    </Dialog>
  );
}
