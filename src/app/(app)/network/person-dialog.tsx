"use client";
import { useEffect, useState } from "react";
import { postJson, errorMessage } from "@/app/lib/api";
import { Button, Dialog, Field, Input, Select, useToast } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { RELATIONS } from "./network-types";

const EMPTY = { name: "", company: "", role_title: "", linkedin_url: "", email: "", relation: "" };

export function PersonDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const m = useMessages();
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
      toast({ title: m.network.person.added(form.name.trim()), tone: "good" });
      onClose();
      await onSaved();
    } catch (e) {
      toast({ title: m.network.person.addFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={m.network.person.title}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {m.common.cancel}
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!form.name.trim()}>
            {m.common.add}
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <Field label={m.network.person.name} htmlFor="p-name">
          <Input id="p-name" value={form.name} onChange={set("name")} autoFocus />
        </Field>
        <div className="form-grid">
          <Field label={m.network.person.company} htmlFor="p-company">
            <Input id="p-company" value={form.company} onChange={set("company")} />
          </Field>
          <Field label={m.network.person.role} htmlFor="p-role">
            <Input id="p-role" value={form.role_title} onChange={set("role_title")} />
          </Field>
        </div>
        <Field label={m.network.person.linkedin} htmlFor="p-linkedin">
          <Input id="p-linkedin" value={form.linkedin_url} onChange={set("linkedin_url")} placeholder={m.network.person.linkedinPlaceholder} />
        </Field>
        <div className="form-grid">
          <Field label={m.network.person.email} htmlFor="p-email">
            <Input id="p-email" type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label={m.network.person.relation} htmlFor="p-relation">
            <Select id="p-relation" value={form.relation} onChange={set("relation")}>
              <option value="">{m.network.person.unspecified}</option>
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {m.labels.relation[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
