"use client";
import { useState } from "react";
import { Trash, Upload } from "lucide-react";
import { errorMessage } from "@/app/lib/api";
import { DOCUMENT_LABELS, documentLabel } from "@/app/lib/labels";
import { localShort } from "@/app/lib/time";
import { Button, ConfirmDialog, EmptyState, Field, Input, Select, useToast } from "@/app/components/ui";

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
  const [docs, setDocs] = useState<DocumentRow[]>(initial);
  const [choice, setChoice] = useState<string>(() => Object.keys(DOCUMENT_LABELS).find((k) => !initial.some((d) => d.key === k)) ?? CUSTOM);
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
      toast({ title: `已保存 ${documentLabel(doc.key)}`, description: "以后要这份文件的表单会自动上传。", tone: "good" });
    } catch (e) {
      toast({ title: "上传失败", description: errorMessage(e), tone: "danger" });
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
      toast({ title: `已删除 ${documentLabel(k)}` });
    } catch (e) {
      toast({ title: "删除失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="doc-upload mb-4">
        <Field label="文件类型" htmlFor="doc-key">
          <div className="row row-nowrap">
            <Select id="doc-key" value={choice} onChange={(e) => setChoice(e.target.value)} style={{ maxWidth: 260 }}>
              {Object.entries(DOCUMENT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                  {docs.some((d) => d.key === k) ? "(已有,会覆盖)" : ""}
                </option>
              ))}
              <option value={CUSTOM}>自定义…</option>
            </Select>
            {choice === CUSTOM ? <Input value={customKey} placeholder="键名,如 gre_score" onChange={(e) => setCustomKey(e.target.value)} style={{ maxWidth: 220 }} /> : null}
          </div>
        </Field>
        <Field label="文件" htmlFor="doc-file" hint="PDF / Word / 图片 / 文本,15 MB 以内。">
          <div className="row row-nowrap">
            <input id="doc-file" type="file" className="file-input" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button variant="primary" icon={<Upload size={14} />} onClick={upload} loading={busy} disabled={!file || !keyOk}>
              上传
            </Button>
          </div>
        </Field>
        {choice === CUSTOM && customKey && !keyOk ? <p className="muted xs">键名只能用小写字母、数字和下划线,以字母开头。</p> : null}
      </div>

      {docs.length === 0 ? (
        <EmptyState compact title="还没有文件" description="成绩单、作品集这类表单常要的附件放在这里,助手投递时自动上传;缺了会在投递页「待处理」里向你要。" />
      ) : (
        <div className="doc-list">
          {docs.map((d) => (
            <div key={d.key} className="doc-row">
              <div className="grow">
                <div className="row">
                  <span className="strong">{documentLabel(d.key)}</span>
                  <span className="mono xs muted">{d.key}</span>
                </div>
                <div className="muted small row">
                  <span className="truncate">{d.filename}</span>
                  <span className="mono xs">{fmtSize(d.size)}</span>
                  <span className="mono xs">{localShort(d.updatedAt)}</span>
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<Trash size={13} />} onClick={() => setConfirmKey(d.key)} disabled={busy}>
                删除
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
        title={`删除「${confirmKey ? documentLabel(confirmKey) : ""}」?`}
        description="文件会从磁盘删除;下次表单要它时助手会再向你要。"
        confirmLabel="删除"
      />
    </div>
  );
}
