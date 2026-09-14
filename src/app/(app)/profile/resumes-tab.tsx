"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Eye, FileText, Sparkles } from "lucide-react";
import { DIRECTIONS, directionLabel } from "@/matcher/directions";
import { postJson, errorMessage } from "@/app/lib/api";
import { localShort } from "@/app/lib/time";
import { Button, Card, Chip, Dialog, Drawer, EmptyState, Field, Input, LinkButton, Select, useToast } from "@/app/components/ui";
import type { ResumeRow } from "./profile-types";

export function ResumesTab({ resumes, hasExperiences }: { resumes: ResumeRow[]; hasExperiences: boolean }) {
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
      toast({ title: "简历已生成", description: `${directionLabel(direction)} 的新版本已加入列表。`, tone: "good" });
      setGenOpen(false);
      setName("");
      router.refresh();
    } catch (e) {
      toast({ title: "生成失败", description: errorMessage(e), tone: "danger", duration: 8000 });
    } finally {
      setBusy(false);
    }
  }

  const genButton = (
    <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => setGenOpen(true)} disabled={!hasExperiences}>
      生成新版本
    </Button>
  );

  return (
    <div>
      {!hasExperiences ? (
        <div className="notice notice-warn mb-4">
          <span>先在「经历」标签录入经历,才能生成简历。</span>
        </div>
      ) : null}
      {resumes.length === 0 ? (
        <EmptyState icon={<FileText size={26} />} title="还没有生成过简历" description="选一个方向,助手从你的经历里挑选、排版,编译出一页 PDF。每个方向一版,投递时按岗位自动选。" action={genButton} />
      ) : (
        <>
          <div className="row between mb-2">
            <span className="muted small">投递时按岗位方向自动选用对应版本。</span>
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
                <div className="muted xs mono mt-2">生成于 {localShort(r.compiled_at)}</div>
                <div className="row mt-3">
                  <Button size="sm" icon={<Eye size={13} />} onClick={() => setPreview(r)}>
                    预览
                  </Button>
                  <LinkButton href={`/api/resumes/${r.id}/pdf`} external size="sm" variant="ghost" icon={<ExternalLink size={13} />}>
                    打开 PDF
                  </LinkButton>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Drawer open={preview !== null} onClose={() => setPreview(null)} title={preview?.version_name ?? ""} subtitle={preview?.directions.map(directionLabel).join(" · ")} width={760}>
        {preview ? <iframe className="pdf-frame" src={`/api/resumes/${preview.id}/pdf`} title={`${preview.version_name} 预览`} /> : null}
      </Drawer>

      <Dialog
        open={genOpen}
        onClose={() => (busy ? null : setGenOpen(false))}
        title="生成新版本"
        description="助手按方向从你的经历里挑选要点并排版,大约 20–40 秒。"
        actions={
          <>
            <Button variant="ghost" onClick={() => setGenOpen(false)} disabled={busy}>
              取消
            </Button>
            <Button variant="primary" onClick={generate} loading={busy}>
              {busy ? "生成中…" : "生成"}
            </Button>
          </>
        }
      >
        <div className="col gap-3">
          <Field label="方向" htmlFor="gen-direction">
            <Select id="gen-direction" value={direction} onChange={(e) => setDirection(e.target.value)}>
              {Object.entries(DIRECTIONS).map(([slug, d]) => (
                <option key={slug} value={slug}>
                  {d.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="版本名" hint="留空自动命名" htmlFor="gen-name">
            <Input id="gen-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${direction}_v2`} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
