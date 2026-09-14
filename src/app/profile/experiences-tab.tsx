"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson, deleteJson, errorMessage } from "@/app/lib/api";
import { EXPERIENCE_KIND_LABEL } from "@/app/lib/labels";
import { Button, Card, Chip, ConfirmDialog, EmptyState, Menu, Section, useToast } from "@/app/components/ui";
import { ExperienceDialog } from "./experience-dialog";
import { EXPERIENCE_KINDS, type Exp } from "./profile-types";

function dateRange(e: Exp): string {
  if (!e.start_date && !e.end_date) return "";
  return `${e.start_date ?? ""}${e.end_date ? ` – ${e.end_date}` : e.start_date ? " – 至今" : ""}`;
}

export function ExperiencesTab({ initial }: { initial: Exp[] }) {
  const [items, setItems] = useState<Exp[]>(initial);
  const [editing, setEditing] = useState<Exp | "new" | null>(null);
  const [deleting, setDeleting] = useState<Exp | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  async function reload() {
    try {
      const j = await getJson<{ experiences: Exp[] }>("/api/experiences");
      setItems(j.experiences ?? []);
    } catch {
      // keep current list
    }
    router.refresh();
  }

  async function remove(e: Exp) {
    if (!e.id) return;
    setBusy(true);
    try {
      await deleteJson(`/api/experiences/${e.id}`);
      setItems((prev) => prev.filter((i) => i.id !== e.id));
      toast({ title: `已删除「${e.title}」`, tone: "neutral" });
      setDeleting(null);
      router.refresh();
    } catch (err) {
      toast({ title: "删除失败", description: errorMessage(err), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const addButton = (
    <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
      添加经历
    </Button>
  );

  return (
    <div>
      {items.length === 0 ? (
        <EmptyState
          art="paper"
          title="还没有录入经历"
          description="像填网申一样,把教育、实习、项目、技能一条条录进来。生成简历时会按目标方向从这里挑选。"
          action={addButton}
        />
      ) : (
        <>
          <div className="row between mb-2">
            <span className="muted small">{items.length} 条经历,按类型分组。每条要点可以标注适用的方向。</span>
            {addButton}
          </div>
          {EXPERIENCE_KINDS.filter((k) => items.some((i) => i.kind === k)).map((k) => (
            <Section key={k} title={EXPERIENCE_KIND_LABEL[k]} count={items.filter((i) => i.kind === k).length}>
              <div className="col gap-3">
                {items
                  .filter((i) => i.kind === k)
                  .map((e) => (
                    <Card key={e.id} className="exp-card">
                      <div className="row between row-nowrap">
                        <div className="grow">
                          <div className="row">
                            <span className="serif strong" style={{ fontSize: "var(--t-md)" }}>
                              {e.title}
                            </span>
                            {e.organization ? <span className="muted">{e.organization}</span> : null}
                            {e.location ? <span className="muted small">{e.location}</span> : null}
                          </div>
                          {dateRange(e) ? <div className="muted small mono mt-1">{dateRange(e)}</div> : null}
                        </div>
                        <Menu
                          label="操作"
                          items={[
                            { label: "编辑", icon: <Pencil size={14} />, onSelect: () => setEditing(e) },
                            "sep",
                            { label: "删除", icon: <Trash size={14} />, danger: true, onSelect: () => setDeleting(e) },
                          ]}
                        />
                      </div>
                      {e.bullets.length > 0 ? (
                        <ul className="exp-bullets">
                          {e.bullets.map((b, i) => (
                            <li key={i}>
                              <span>{b.text}</span>
                              {b.directions?.length ? (
                                <span className="row gap-1" style={{ display: "inline-flex", marginLeft: 6 }}>
                                  {b.directions.map((d) => (
                                    <Chip key={d} outline>
                                      {directionLabel(d)}
                                    </Chip>
                                  ))}
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </Card>
                  ))}
              </div>
            </Section>
          ))}
        </>
      )}

      <ExperienceDialog open={editing !== null} initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
        busy={busy}
        danger
        title={deleting ? `删除「${deleting.title}」?` : "删除"}
        description="删除后不可恢复;已经生成的简历 PDF 不受影响。"
        confirmLabel="删除"
      />
    </div>
  );
}
