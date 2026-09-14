"use client";
import { useEffect, useState } from "react";
import { postJson, errorMessage } from "@/app/lib/api";
import { RELATION_LABEL } from "@/app/lib/labels";
import { Button, Dialog, Field, Input, Select, useToast } from "@/app/components/ui";
import { RELATIONS } from "./network-types";

const EMPTY = { name: "", company: "", role_title: "", linkedin_url: "", email: "", relation: "" };

export function PersonDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) setForm(EMPTY);
  }, [open]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await postJson("/api/network/people", {
        name: form.name.trim(),
        company: form.company.trim() || null,
        role_title: form.role_title.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        email: form.email.trim() || null,
        relation: form.relation || null,
        source: "manual",
      });
      toast({ title: `已添加 ${form.name.trim()}`, tone: "good" });
      onClose();
      await onSaved();
    } catch (e) {
      toast({ title: "添加失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="添加联系人"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form.name.trim()}>
            添加
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <Field label="姓名" htmlFor="p-name">
          <Input id="p-name" value={form.name} onChange={set("name")} autoFocus />
        </Field>
        <div className="form-grid">
          <Field label="公司" htmlFor="p-company">
            <Input id="p-company" value={form.company} onChange={set("company")} />
          </Field>
          <Field label="职位" htmlFor="p-role">
            <Input id="p-role" value={form.role_title} onChange={set("role_title")} />
          </Field>
        </div>
        <Field label="LinkedIn 链接" htmlFor="p-linkedin">
          <Input id="p-linkedin" value={form.linkedin_url} onChange={set("linkedin_url")} placeholder="https://www.linkedin.com/in/…" />
        </Field>
        <div className="form-grid">
          <Field label="邮箱" htmlFor="p-email">
            <Input id="p-email" type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="关系" htmlFor="p-relation">
            <Select id="p-relation" value={form.relation} onChange={set("relation")}>
              <option value="">未指定</option>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {RELATION_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
