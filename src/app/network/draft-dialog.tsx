"use client";
import { useEffect, useState } from "react";
import { postJson, errorMessage } from "@/app/lib/api";
import { MSG_CHANNEL_LABEL, PLAYBOOK_LABEL } from "@/app/lib/labels";
import { Button, Dialog, Field, Select, useToast } from "@/app/components/ui";
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
      toast({ title: "草稿已生成", description: "在「待批准草稿」里查看、修改并批准。", tone: "good" });
      onClose();
      await onCreated();
    } catch (e) {
      toast({ title: "生成失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="AI 草稿"
      description="按剧本给这位联系人写第一条消息;生成后你可以改,批准了才会发。"
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button variant="primary" onClick={generate} loading={busy} disabled={!personId}>
            {busy ? "生成中,约 30 秒…" : "生成草稿"}
          </Button>
        </>
      }
    >
      <div className="col gap-3">
        <Field label="联系人" htmlFor="d-person">
          <Select id="d-person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">选择联系人…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.company ? ` · ${p.company}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="剧本" htmlFor="d-playbook">
          <Select id="d-playbook" value={playbook} onChange={(e) => setPlaybook(e.target.value)}>
            {NETWORK_PLAYBOOKS.map((pb) => (
              <option key={pb} value={pb}>
                {PLAYBOOK_LABEL[pb]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="渠道" htmlFor="d-channel">
          <Select id="d-channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {MSG_CHANNEL_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
