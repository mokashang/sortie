"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Eye, Sparkles } from "lucide-react";
import { DIRECTIONS, directionLabel } from "@/matcher/directions";
import { postJson, errorMessage } from "@/app/lib/api";
import { localShort } from "@/app/lib/time";
import { Button, Card, Chip, Dialog, Drawer, EmptyState, Field, Input, LinkButton, Select, useToast } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import type { ResumeRow } from "./profile-types";

export function ResumesTab({ resumes, hasExperiences }: { resumes: ResumeRow[]; hasExperiences: boolean }) {
  const m = useMessages();
  const [preview, setPreview] = useState<ResumeRow | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [direction, setDirection] = useState("swe_general");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function generate() {
    setBusy(true);
    try {
      await postJson("/api/resumes/generate", { direction, versionName: name.trim() || undefined });
      toast({ title: m.profile.resumes.generated, description: m.profile.resumes.generatedDescription(directionLabel(direction)), tone: "good" });
      setGenOpen(false);
      setName("");
      router.refresh();
    } catch (e) {
      toast({ title: m.profile.resumes.generateFailed, description: errorMessage(e), tone: "danger", duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  const genButton = (
    <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => setGenOpen(true)} disabled={!hasExperiences}>
      {m.profile.resumes.generate}
    </Button>
  );

  return (
    <div>
      {!hasExperiences ? (
        <div className="notice notice-warn mb-4">
          <span>{m.profile.resumes.needExperiences}</span>
        </div>
      ) : null}
      {resumes.length === 0 ? (
        <EmptyState art="paper" title={m.profile.resumes.emptyTitle} description={m.profile.resumes.emptyDescription} action={genButton} />
      ) : (
        <>
          <div className="row between mb-2">
            <span className="muted small">{m.profile.resumes.summary}</span>
            {genButton}
          </div>
          <div className="resume-grid">
            {resumes.map((r) => (
              <Card key={r.id} className="resume-card">
                <div className="serif strong" style={{ fontSize: "var(--t-md)" }}>
                  {r.version_name}
                </div>
                <div className="row mt-2">
                  {r.directions.map((d) => (
                    <Chip key={d} outline>
                      {directionLabel(d)}
                    </Chip>
                  ))}
                </div>
                <div className="muted xs mono mt-2">{m.profile.resumes.compiledAt(localShort(r.compiled_at))}</div>
                <div className="row mt-3">
                  <Button size="sm" icon={<Eye size={13} />} onClick={() => setPreview(r)}>
                    {m.profile.resumes.preview}
                  </Button>
                  <LinkButton href={`/api/resumes/${r.id}/pdf`} external size="sm" variant="ghost" icon={<ExternalLink size={13} />}>
                    {m.profile.resumes.openPdf}
                  </LinkButton>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Drawer open={preview !== null} onClose={() => setPreview(null)} title={preview?.version_name ?? ""} subtitle={preview?.directions.map(directionLabel).join(" · ")} width={760}>
        {preview ? <iframe className="pdf-frame" src={`/api/resumes/${preview.id}/pdf`} title={m.profile.resumes.previewTitle(preview.version_name)} /> : null}
      </Drawer>

      <Dialog
        open={genOpen}
        onClose={() => (busy ? null : setGenOpen(false))}
        title={m.profile.resumes.generate}
        description={m.profile.resumes.dialogDescription}
        actions={
          <>
            <Button variant="ghost" onClick={() => setGenOpen(false)} disabled={busy}>
              {m.common.cancel}
            </Button>
            <Button variant="primary" onClick={generate} loading={busy}>
              {busy ? m.profile.resumes.generating : m.profile.resumes.generateAction}
            </Button>
          </>
        }
      >
        <div className="col gap-3">
          <Field label={m.profile.resumes.direction} htmlFor="gen-direction">
            <Select id="gen-direction" value={direction} onChange={(e) => setDirection(e.target.value)}>
              {Object.entries(DIRECTIONS).map(([slug, d]) => (
                <option key={slug} value={slug}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={m.profile.resumes.versionName} hint={m.profile.resumes.versionNameHint} htmlFor="gen-name">
            <Input id="gen-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${direction}_v2`} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
