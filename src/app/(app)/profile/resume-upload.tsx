"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileUp, Upload } from "lucide-react";
import { postJson, errorMessage } from "@/app/lib/api";
import { localShort } from "@/app/lib/time";
import { Button, Card, LinkButton, useToast } from "@/app/components/ui";
import type { ButtonVariant } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import type { DocumentRow } from "./documents-tab";

// 档案 → 简历 → 你的简历 (2026-10-22): the resume the account already has, uploaded once and attached
// to every application whose track has no tailored version (src/apply/resume-select.ts). Stored
// as the document key `resume`, the same folder the 文件 tab manages.
export const RESUME_KEY = "resume";

function fmtSize(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function isPdf(doc: DocumentRow | null): boolean {
  return !!doc && doc.filename.toLowerCase().endsWith(".pdf");
}

// 从简历导入经历: the AI provider splits the uploaded PDF into experience entries (src/resume/import.ts).
export function ImportFromResumeButton({ onDone, variant = "secondary", disabled }: { onDone?: () => void; variant?: ButtonVariant; disabled?: boolean }) {
  const m = useMessages();
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();
  async function run() {
    setBusy(true);
    try {
      const r = await postJson<{ created: number; skipped: number; filled: string[] }>("/api/experiences/import", {});
      toast({ title: m.profile.upload.imported(r.created), description: m.profile.upload.importedDescription(r.skipped, r.filled.length), tone: r.created > 0 ? "good" : "info", duration: 8000 });
      onDone?.();
      router.refresh();
    } catch (e) {
      toast({ title: m.profile.upload.importFailed, description: errorMessage(e), tone: "danger", duration: 8000 });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant={variant} icon={<FileUp size={14} />} onClick={() => void run()} loading={busy} disabled={disabled}>
      {busy ? m.profile.upload.importing : m.profile.upload.importButton}
    </Button>
  );
}

export function ResumeUploadCard({ initial, onChange }: { initial: DocumentRow | null; onChange?: (doc: DocumentRow) => void }) {
  const m = useMessages();
  const [doc, setDoc] = useState<DocumentRow | null>(initial);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [justUploaded, setJustUploaded] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("key", RESUME_KEY);
      fd.append("file", file);
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { document?: DocumentRow; error?: string };
      if (!res.ok || !j.document) throw new Error(j.error ?? `HTTP ${res.status}`);
      setDoc(j.document);
      setFile(null);
      setJustUploaded(true);
      onChange?.(j.document);
      toast({ title: m.profile.upload.uploaded, description: m.profile.upload.uploadedDescription, tone: "good" });
      router.refresh();
    } catch (e) {
      toast({ title: m.profile.upload.uploadFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const picker = (
    <div className="row row-nowrap">
      <input
        id="resume-file"
        type="file"
        className="file-input"
        accept=".pdf,.doc,.docx"
        aria-label={m.profile.upload.fileLabel}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Button variant={doc ? "secondary" : "primary"} icon={<Upload size={14} />} onClick={() => void upload()} loading={busy} disabled={!file}>
        {doc ? m.profile.upload.replace : m.profile.upload.upload}
      </Button>
    </div>
  );

  return (
    <Card tone={doc ? undefined : "accent"} className="mb-4">
      <div className="col gap-3">
        <div>
          <div className="strong">{doc ? m.profile.upload.title : m.profile.upload.emptyTitle}</div>
          <div className="muted small">{doc ? m.profile.upload.description : m.profile.upload.emptyDescription}</div>
        </div>
        {doc ? (
          <div className="row between">
            <div className="muted small row">
              <span className="strong">{doc.filename}</span>
              <span className="mono xs">{fmtSize(doc.size)}</span>
              <span className="mono xs">{localShort(doc.updatedAt)}</span>
            </div>
            <div className="row">
              <LinkButton href={`/api/documents/file?key=${RESUME_KEY}`} external size="sm" variant="ghost" icon={<ExternalLink size={13} />}>
                {m.profile.upload.open}
              </LinkButton>
              {isPdf(doc) ? <ImportFromResumeButton variant={justUploaded ? "primary" : "secondary"} /> : null}
            </div>
          </div>
        ) : null}
        {picker}
      </div>
    </Card>
  );
}
