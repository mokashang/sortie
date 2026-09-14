"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson, deleteJson, errorMessage } from "@/app/lib/api";
import { labelOf } from "@/app/lib/labels";
import { Button, Card, Chip, ConfirmDialog, EmptyState, Menu, Section, useToast } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { ExperienceDialog } from "./experience-dialog";
import { EXPERIENCE_KINDS, type Exp } from "./profile-types";

// `present` is the word for an open-ended range (至今 / Present) in the current language.
function dateRange(e: Exp, present: string): string {
  if (!e.start_date && !e.end_date) return "";
  return `${e.start_date ?? ""}${e.end_date ? ` – ${e.end_date}` : e.start_date ? ` – ${present}` : ""}`;
}

export function ExperiencesTab({ initial }: { initial: Exp[] }) {
  const m = useMessages();
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
      toast({ title: m.profile.experiences.deleted(e.title), tone: "neutral" });
      setDeleting(null);
      router.refresh();
    } catch (err) {
      toast({ title: m.profile.experiences.deleteFailed, description: errorMessage(err), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const addButton = (
    <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
      {m.profile.experiences.add}
    </Button>
  );

  return (
    <div>
      {items.length === 0 ? (
        <EmptyState
          art="paper"
          title={m.profile.experiences.emptyTitle}
          description={m.profile.experiences.emptyDescription}
          action={addButton}
        />
      ) : (
        <>
          <div className="row between mb-2">
            <span className="muted small">{m.profile.experiences.summary(items.length)}</span>
            {addButton}
          </div>
          {EXPERIENCE_KINDS.filter((k) => items.some((i) => i.kind === k)).map((k) => (
            <Section key={k} title={labelOf(m.labels.experienceKind, k)} count={items.filter((i) => i.kind === k).length}>
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
                          {dateRange(e, m.profile.experiences.present) ? <div className="muted small mono mt-1">{dateRange(e, m.profile.experiences.present)}</div> : null}
                        </div>
                        <Menu
                          label={m.profile.experiences.actions}
                          items={[
                            { label: m.common.edit, icon: <Pencil size={14} />, onSelect: () => setEditing(e) },
                            "sep",
                            { label: m.common.delete, icon: <Trash size={14} />, danger: true, onSelect: () => setDeleting(e) },
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
        title={deleting ? m.profile.experiences.deleteTitle(deleting.title) : m.common.delete}
        description={m.profile.experiences.deleteDescription}
        confirmLabel={m.common.delete}
      />
    </div>
  );
}
