"use client";
import { useEffect, useState } from "react";
import { postJson, errorMessage } from "@/app/lib/api";
import { Button, Dialog, Field, Select, useToast } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { CHANNELS, NETWORK_PLAYBOOKS, type Person } from "./network-types";

export interface DraftDialogProps {
  open: boolean;
  onClose: () => void;
  people: Person[];
  defaultPersonId: number | null;
  onCreated: () => Promise<void> | void;
}

// AI 草稿: pick the contact, the playbook and the channel; the App (Claude) writes the first draft.
export function DraftDialog({ open, onClose, people, defaultPersonId, onCreated }: DraftDialogProps) {
  const m = useMessages();
  const [personId, setPersonId] = useState<string>("");
  const [playbook, setPlaybook] = useState<string>("coffee_chat");
  const [channel, setChannel] = useState<string>("linkedin");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) setPersonId(defaultPersonId != null ? String(defaultPersonId) : "");
  }, [open, defaultPersonId]);

  async function generate() {
    if (!personId) return;
    setBusy(true);
    try {
      await postJson("/api/network/draft", { personId: Number(personId), playbook, channel });
      toast({ title: m.network.draft.created, description: m.network.draft.createdDescription, tone: "good" });
      onClose();
      await onCreated();
    } catch (e) {
      toast({ title: m.network.draft.failed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={m.network.draft.title}
      description={m.network.draft.description}
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {m.common.cancel}
          </Button>
          <Button variant="primary" onClick={generate} loading={busy} disabled={!personId}>
            {busy ? m.network.draft.generating : m.network.draft.generate}
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <Field label={m.network.draft.person} htmlFor="d-person">
          <Select id="d-person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">{m.network.draft.pickPerson}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.company ? ` · ${p.company}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={m.network.draft.playbook} htmlFor="d-playbook">
          <Select id="d-playbook" value={playbook} onChange={(e) => setPlaybook(e.target.value)}>
            {NETWORK_PLAYBOOKS.map((pb) => (
              <option key={pb} value={pb}>
                {m.labels.playbook[pb]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={m.network.draft.channel} htmlFor="d-channel">
          <Select id="d-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {m.labels.msgChannel[c]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
