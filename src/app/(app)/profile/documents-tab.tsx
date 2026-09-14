"use client";
import { useState } from "react";
import { Trash, Upload } from "lucide-react";
import { errorMessage } from "@/app/lib/api";
import { documentLabel } from "@/app/lib/labels";
import { localShort } from "@/app/lib/time";
import { Button, ConfirmDialog, EmptyState, Field, Input, Select, useToast } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";

export interface DocumentRow {
  key: string;
  filename: string;
  path: string;
  size: number;
  updatedAt: string;
}

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const CUSTOM = "__custom__";

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// 文件: standing documents the assistant uploads into forms besides the resume — transcripts,
// a cover-letter template, a portfolio. One file per key; uploading again replaces it. A form
// that asks for one the assistant doesn't have yet becomes a 待处理 card instead of a dead end.
export function DocumentsTab({ initial }: { initial: DocumentRow[] }) {
  const m = useMessages();
  const lang = useLang();
  const [docs, setDocs] = useState<DocumentRow[]>(initial);
  const knownKeys = Object.keys(m.labels.documents);
  const [choice, setChoice] = useState<string>(() => knownKeys.find((k) => !initial.some((d) => d.key === k)) ?? CUSTOM);
  const [customKey, setCustomKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const { toast } = useToast();

  const key = choice === CUSTOM ? customKey.trim() : choice;
  const keyOk = KEY_RE.test(key);

  async function upload() {
    if (!file || !keyOk) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("key", key);
      fd.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { document?: DocumentRow; error?: string };
      if (!res.ok || !j.document) throw new Error(j.error ?? `HTTP ${res.status}`);
      const doc = j.document;
      setDocs((prev) => [...prev.filter((d) => d.key !== doc.key), doc].sort((a, b) => a.key.localeCompare(b.key)));
      setFile(null);
      setCustomKey("");
      toast({ title: m.profile.documents.saved(documentLabel(doc.key, lang)), description: m.profile.documents.savedDescription, tone: "good" });
    } catch (e) {
      toast({ title: m.profile.documents.uploadFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/documents?key=${encodeURIComponent(k)}`, { method: "DELETE" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      setDocs((prev) => prev.filter((d) => d.key !== k));
      setConfirmKey(null);
      toast({ title: m.profile.documents.deleted(documentLabel(k, lang)) });
    } catch (e) {
      toast({ title: m.profile.documents.deleteFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="doc-upload mb-4">
        <Field label={m.profile.documents.typeLabel} htmlFor="doc-key">
          <div className="row row-nowrap">
            <Select id="doc-key" value={choice} onChange={(e) => setChoice(e.target.value)} style={{ maxWidth: 260 }}>
              {knownKeys.map((k) => (
                <option key={k} value={k}>
                  {documentLabel(k, lang)}
                  {docs.some((d) => d.key === k) ? m.profile.documents.alreadyHave : ""}
                </option>
              ))}
              <option value={CUSTOM}>{m.profile.documents.custom}</option>
            </Select>
            {choice === CUSTOM ? <Input value={customKey} placeholder={m.profile.documents.keyPlaceholder} onChange={(e) => setCustomKey(e.target.value)} style={{ maxWidth: 220 }} /> : null}
          </div>
        </Field>
        <Field label={m.profile.documents.fileLabel} htmlFor="doc-file" hint={m.profile.documents.fileHint}>
          <div className="row row-nowrap">
            <input id="doc-file" type="file" className="file-input" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button variant="primary" icon={<Upload size={14} />} onClick={upload} loading={busy} disabled={!file || !keyOk}>
              {m.profile.documents.upload}
            </Button>
          </div>
        </Field>
        {choice === CUSTOM && customKey && !keyOk ? <p className="muted xs">{m.profile.documents.keyRuleHint}</p> : null}
      </div>

      {docs.length === 0 ? (
        <EmptyState compact title={m.profile.documents.emptyTitle} description={m.profile.documents.emptyDescription} />
      ) : (
        <div className="doc-list">
          {docs.map((d) => (
            <div key={d.key} className="doc-row">
              <div className="grow">
                <div className="row">
                  <span className="strong">{documentLabel(d.key, lang)}</span>
                  <span className="mono xs muted">{d.key}</span>
                </div>
                <div className="muted small row">
                  <span className="truncate">{d.filename}</span>
                  <span className="mono xs">{fmtSize(d.size)}</span>
                  <span className="mono xs">{localShort(d.updatedAt)}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<Trash size={13} />} onClick={() => setConfirmKey(d.key)} disabled={busy}>
                {m.common.delete}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmKey !== null}
        onClose={() => setConfirmKey(null)}
        onConfirm={() => {
          if (confirmKey) void remove(confirmKey);
        }}
        busy={busy}
        danger
        title={m.profile.documents.removeTitle(confirmKey ? documentLabel(confirmKey, lang) : "")}
        description={m.profile.documents.removeDescription}
        confirmLabel={m.common.delete}
      />
    </div>
  );
}
