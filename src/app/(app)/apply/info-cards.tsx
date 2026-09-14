"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, MessageSquare, RotateCcw, Trash, UserCheck } from "lucide-react";
import { directionName, documentLabel, labelOf } from "@/app/lib/labels";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { Button, Card, Checkbox, Chip, EmptyState, Field, Input, LinkButton, Section, Select, Tooltip, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { useLang, useMessages } from "@/i18n/client";
import type { Messages } from "@/i18n/messages";

type Kind = "text" | "file" | "login" | "action" | "manual";

interface Question {
  key: string;
  label: string;
  hint?: string;
  options?: string[];
  optional?: boolean;
  kind?: Kind;
  multiple?: boolean;
  url?: string;
  host?: string;
  accept?: string;
}

export interface InfoRow {
  jobId: number;
  company: string;
  title: string;
  applyUrl: string | null;
  direction: string | null;
  status: string; // 'needs_info' (assistant waiting on the form) | 'matched' (paused; the assistant moved on)
  needsManualReason: string | null;
  questions: Question[];
  askedAt: string;
}

interface DocumentRow {
  key: string;
  filename: string;
  path: string;
  size: number;
  updatedAt: string;
}

type Draft = { value: string; onlyOnce: boolean; fileName?: string };
type Continued = { status?: string; autoStarted?: boolean };

const MULTI_SEP = "; ";
const kindOf = (q: Question): Kind => q.kind ?? "text";
const isExternal = (url: string) => /^https?:\/\//i.test(url);

// What the card turns into: a login wall groups every job on that site into one card; something
// only the user can finish is a short "do it yourself" card; everything else is a small form.
function cardKind(row: InfoRow): "login" | "manual" | "form" {
  if (row.questions.some((q) => kindOf(q) === "login")) return "login";
  if (row.questions.some((q) => kindOf(q) === "manual")) return "manual";
  return "form";
}

function continueText(j: Continued, m: Messages): string {
  if (j.status === "prepared") return m.apply.todo.continueForm;
  return j.autoStarted ? m.apply.todo.continueRequeued : m.apply.todo.continueBusy;
}

async function uploadDocument(key: string, file: File): Promise<DocumentRow> {
  const fd = new FormData();
  fd.append("key", key);
  fd.append("file", file);
  const res = await fetch("/api/documents", { method: "POST", body: fd });
  const j = (await res.json().catch(() => ({}))) as { document?: DocumentRow; error?: string };
  if (!res.ok || !j.document) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.document;
}

// `waiting` = an apply run is actually running, so a needs_info row really has an assistant on
// its tab; otherwise the one that asked is gone and answering re-queues the job instead.
function Head({ row, kindLabel, waiting }: { row: InfoRow; kindLabel: string; waiting: boolean }) {
  const m = useMessages();
  const lang = useLang();
  return (
    <div className="row between">
      <div className="grow">
        <div className="confirm-title">
          <span className="serif strong">{row.company}</span>
          <span className="muted"> · </span>
          <span>{row.title}</span>
        </div>
        <div className="row mt-2">
          <Chip>{directionName(row.direction, lang)}</Chip>
          <Chip tone="accent">{kindLabel}</Chip>
          {row.status === "needs_info" && waiting ? (
            <Chip tone="warn">{m.apply.todo.waiting(row.askedAt)}</Chip>
          ) : row.status === "needs_info" ? (
            <Chip tone="neutral">{m.apply.todo.assistantLeft}</Chip>
          ) : (
            <Chip tone="neutral" title={row.needsManualReason ?? undefined}>
              {m.apply.todo.paused}
            </Chip>
          )}
        </div>
      </div>
      {row.applyUrl ? (
        <LinkButton href={row.applyUrl} external size="sm" variant="ghost">
          {m.apply.todo.viewJob}
        </LinkButton>
      ) : null}
    </div>
  );
}

// 待处理: everything the assistant stopped on that only the user can move — a missing answer or
// file, a site to log into once, something to do in the open tab, or a form to finish by hand.
// Each card ends in an action that lets the assistant continue on its own; nothing here is a
// dead end. Renders nothing in compact mode when there is nothing to do.
export function InfoCards({ compact = false }: { compact?: boolean }) {
  const m = useMessages();
  const lang = useLang();
  const [rows, setRows] = useState<InfoRow[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [drafts, setDrafts] = useState<Record<number, Record<string, Draft>>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { data: overview, refresh: refreshOverview } = useOverview();
  const { toast } = useToast();
  const applyRunning = overview?.assistant?.kind === "apply" && overview?.assistant?.status === "running";

  const refresh = useCallback(async () => {
    try {
      const j = await getJson<{ needsInfo: InfoRow[] }>("/api/apply/pending");
      setRows(j.needsInfo ?? []);
    } catch {
      // keep last known list
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  // Standing documents, only fetched once a file item shows up: an already-uploaded transcript
  // pre-fills the item so the user just confirms.
  const wantsDocs = rows.some((r) => r.questions.some((q) => kindOf(q) === "file"));
  useEffect(() => {
    if (!wantsDocs) return;
    getJson<{ documents: DocumentRow[] }>("/api/documents")
      .then((j) => setDocs(j.documents ?? []))
      .catch(() => setDocs([]));
  }, [wantsDocs]);

  const draft = (jobId: number, key: string): Draft => drafts[jobId]?.[key] ?? { value: "", onlyOnce: false };
  const setDraft = useCallback((jobId: number, key: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [jobId]: { ...(prev[jobId] ?? {}), [key]: { ...(prev[jobId]?.[key] ?? { value: "", onlyOnce: false }), ...patch } },
    }));
  }, []);

  useEffect(() => {
    if (docs.length === 0) return;
    for (const row of rows) {
      for (const q of row.questions) {
        if (kindOf(q) !== "file") continue;
        const doc = docs.find((d) => d.key === q.key);
        if (doc && !drafts[row.jobId]?.[q.key]?.value) setDraft(row.jobId, q.key, { value: doc.path, fileName: doc.filename });
      }
    }
    // drafts deliberately not a dependency: this only seeds empty file items when docs/rows change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, rows, setDraft]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusyKey(key);
    try {
      await fn();
      await refresh();
      await refreshOverview();
    } finally {
      setBusyKey(null);
    }
  }

  async function submit(row: InfoRow) {
    await run(`submit-${row.jobId}`, async () => {
      try {
        const answers: Record<string, { value: string; remember: boolean }> = {};
        for (const q of row.questions) {
          const kind = kindOf(q);
          if (kind === "login" || kind === "manual") continue;
          const d = draft(row.jobId, q.key);
          answers[q.key] = { value: d.value, remember: kind === "text" && !d.onlyOnce };
        }
        const j = await postJson<Continued>("/api/apply/answer-info", { jobId: row.jobId, answers });
        toast({ title: m.apply.todo.submitted(row.company), description: continueText(j, m), tone: "good" });
      } catch (e) {
        toast({ title: m.apply.todo.submitFailed, description: errorMessage(e), tone: "danger" });
      }
    });
  }

  async function loginDone(host: string, count: number) {
    await run(`login-${host}`, async () => {
      try {
        const j = await postJson<Continued & { jobIds?: number[] }>("/api/apply/login-done", { host });
        const n = j.jobIds?.length ?? count;
        toast({ title: m.apply.todo.releasedHost(host, n), description: continueText(j, m), tone: "good" });
      } catch (e) {
        toast({ title: m.apply.todo.releaseFailed, description: errorMessage(e), tone: "danger" });
      }
    });
  }

  async function retry(row: InfoRow) {
    await run(`retry-${row.jobId}`, async () => {
      try {
        const j = await postJson<Continued>("/api/apply/unpark", { jobId: row.jobId });
        toast({ title: m.apply.todo.handedBack(row.company), description: continueText(j, m), tone: "good" });
      } catch (e) {
        toast({ title: m.apply.todo.retryFailed, description: errorMessage(e), tone: "danger" });
      }
    });
  }

  async function selfSubmitted(row: InfoRow) {
    await run(`self-${row.jobId}`, async () => {
      try {
        await postJson("/api/apply/self-submitted", { jobId: row.jobId });
        toast({ title: m.apply.todo.selfSubmittedToast(row.company), description: m.apply.todo.selfSubmittedDescription, tone: "good" });
      } catch (e) {
        toast({ title: m.apply.todo.selfSubmitFailed, description: errorMessage(e), tone: "danger" });
      }
    });
  }

  async function skip(row: InfoRow) {
    await run(`skip-${row.jobId}`, async () => {
      try {
        await postJson("/api/apply/archive-manual", { jobIds: [row.jobId] });
        toast({
          title: m.apply.todo.skipped(row.company, row.title),
          description: m.apply.todo.skippedDescription,
          action: {
            label: m.common.undo,
            onClick: () => {
              postJson("/api/queue/unarchive", { jobId: row.jobId })
                .then(async () => {
                  toast({ title: m.apply.todo.restored, tone: "good" });
                  await refresh();
                  await refreshOverview();
                })
                .catch((e) => toast({ title: m.apply.todo.restoreFailed, description: errorMessage(e), tone: "danger" }));
            },
          },
        });
      } catch (e) {
        toast({ title: m.apply.todo.skipFailed, description: errorMessage(e), tone: "danger" });
      }
    });
  }

  const skipButton = (row: InfoRow) => (
    <Button size="sm" variant="ghost" icon={<Trash size={13} />} onClick={() => skip(row)} loading={busyKey === `skip-${row.jobId}`} disabled={busyKey !== null && busyKey !== `skip-${row.jobId}`}>
      {m.apply.todo.skipJob}
    </Button>
  );

  // Login walls: one card per site, listing every job waiting behind it.
  const loginGroups = new Map<string, { item: Question; rows: InfoRow[] }>();
  const orderedKeys: string[] = [];
  for (const row of rows) {
    if (cardKind(row) !== "login") continue;
    const item = row.questions.find((q) => kindOf(q) === "login")!;
    const host = item.host ?? item.url ?? `job-${row.jobId}`;
    const g = loginGroups.get(host);
    if (g) g.rows.push(row);
    else {
      loginGroups.set(host, { item, rows: [row] });
      orderedKeys.push(host);
    }
  }
  const seenLogin = new Set<string>();

  const cards = rows.flatMap((row) => {
    const kind = cardKind(row);

    if (kind === "login") {
      const item = row.questions.find((q) => kindOf(q) === "login")!;
      const host = item.host ?? item.url ?? `job-${row.jobId}`;
      if (seenLogin.has(host)) return [];
      seenLogin.add(host);
      const group = loginGroups.get(host)!;
      const busy = busyKey === `login-${host}`;
      return [
        <Card key={`login-${host}`} tone="warn" className="todo-card">
          <div className="row between">
            <div className="grow">
              <div className="confirm-title">
                <span className="serif strong">{group.item.label}</span>
              </div>
              <div className="row mt-2">
                <Chip tone="accent">{labelOf(m.labels.infoKind, "login")}</Chip>
                <Chip tone="neutral">{m.apply.todo.login.paused}</Chip>
                {group.item.host ? <Chip outline>{group.item.host}</Chip> : null}
              </div>
            </div>
          </div>
          {group.item.hint ? <p className="muted small todo-hint mt-3">{group.item.hint}</p> : null}
          <p className="muted small mt-3">{m.apply.todo.login.instructions}</p>
          <ul className="todo-jobs mt-3">
            {group.rows.map((r) => (
              <li key={r.jobId} className="todo-job">
                <span className="serif strong">{r.company}</span>
                <span className="muted">·</span>
                <span className="truncate">{r.title}</span>
                <Chip outline>{directionName(r.direction, lang)}</Chip>
                <span className="grow" />
                {skipButton(r)}
              </li>
            ))}
          </ul>
          <div className="row mt-4">
            {group.item.url ? (
              <LinkButton href={group.item.url} external icon={<ExternalLink size={14} />}>
                {m.apply.todo.login.open}
              </LinkButton>
            ) : null}
            <Button variant="primary" icon={<Check size={14} />} onClick={() => loginDone(host, group.rows.length)} loading={busy} disabled={busyKey !== null && !busy}>
              {m.apply.todo.login.done}
            </Button>
          </div>
        </Card>,
      ];
    }

    if (kind === "manual") {
      const items = row.questions.filter((q) => kindOf(q) === "manual");
      const first = items[0];
      const url = first.url ?? row.applyUrl ?? "";
      const retryPrimary = first.key === "error" || first.key === "rejected" || first.key === "no_resume";
      return [
        <Card key={row.jobId} tone="warn" className="todo-card">
          <Head row={row} kindLabel={labelOf(m.labels.infoKind, "manual")} waiting={applyRunning} />
          <div className="col gap-2 mt-3">
            {items.map((q) => (
              <div key={q.key}>
                <div className="strong">{q.label}</div>
                {q.hint ? <p className="muted small todo-hint mt-1">{q.hint}</p> : null}
              </div>
            ))}
          </div>
          <div className="row mt-4">
            {url ? (
              <LinkButton href={url} external={isExternal(url)} icon={<ExternalLink size={14} />}>
                {isExternal(url) ? m.apply.todo.manual.openApplyPage : m.apply.todo.manual.handle}
              </LinkButton>
            ) : null}
            <Button variant={retryPrimary ? "primary" : "secondary"} icon={<RotateCcw size={14} />} onClick={() => retry(row)} loading={busyKey === `retry-${row.jobId}`} disabled={busyKey !== null && busyKey !== `retry-${row.jobId}`}>
              {m.apply.todo.manual.retry}
            </Button>
            <Button icon={<UserCheck size={14} />} onClick={() => selfSubmitted(row)} loading={busyKey === `self-${row.jobId}`} disabled={busyKey !== null && busyKey !== `self-${row.jobId}`}>
              {m.apply.todo.manual.selfDone}
            </Button>
            {skipButton(row)}
          </div>
        </Card>,
      ];
    }

    const answerable = row.questions.filter((q) => kindOf(q) !== "login" && kindOf(q) !== "manual");
    const missing = answerable.some((q) => !q.optional && !draft(row.jobId, q.key).value.trim());
    const kinds = new Set(answerable.map(kindOf));
    const kindLabel = kinds.has("file") ? labelOf(m.labels.infoKind, "file") : kinds.has("action") ? labelOf(m.labels.infoKind, "action") : labelOf(m.labels.infoKind, "text");
    return [
      <Card key={row.jobId} tone="warn" className="todo-card">
        <Head row={row} kindLabel={kindLabel} waiting={applyRunning} />

        <div className="col gap-3 mt-4">
          {answerable.map((q) => {
            const d = draft(row.jobId, q.key);
            const id = `info-${row.jobId}-${q.key}`;
            const kind = kindOf(q);
            const label = (
              <>
                {q.label}
                {q.optional ? <span className="muted xs">{m.apply.todo.field.optional}</span> : null}
                {kind === "text" ? <Tooltip content={m.apply.todo.field.rememberTip(q.key)} /> : null}
                {kind === "file" ? <Tooltip content={m.apply.todo.field.fileTip(documentLabel(q.key, lang))} /> : null}
              </>
            );

            if (kind === "action") {
              return (
                <Field key={q.key} label={label} hint={q.hint}>
                  <Checkbox label={m.apply.todo.field.actionDone} checked={d.value === "done"} onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.checked ? "done" : "" })} />
                </Field>
              );
            }

            if (kind === "file") {
              const uploading = busyKey === `upload-${row.jobId}-${q.key}`;
              return (
                <Field key={q.key} htmlFor={id} label={label} hint={q.hint}>
                  {d.value ? (
                    <div className="row">
                      <Chip tone="good" icon={<Check size={12} />}>
                        {d.fileName ?? d.value}
                      </Chip>
                      <Button size="sm" variant="ghost" onClick={() => setDraft(row.jobId, q.key, { value: "", fileName: undefined })}>
                        {m.apply.todo.field.changeFile}
                      </Button>
                    </div>
                  ) : (
                    <div className="row row-nowrap">
                      <input
                        id={id}
                        type="file"
                        className="file-input"
                        accept={q.accept}
                        disabled={uploading}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          setBusyKey(`upload-${row.jobId}-${q.key}`);
                          try {
                            const doc = await uploadDocument(q.key, f);
                            setDocs((prev) => [...prev.filter((x) => x.key !== doc.key), doc]);
                            setDraft(row.jobId, q.key, { value: doc.path, fileName: doc.filename });
                            toast({ title: m.apply.todo.field.fileUploaded(documentLabel(doc.key, lang)), description: m.apply.todo.field.fileUploadedDescription, tone: "good" });
                          } catch (err) {
                            toast({ title: m.apply.todo.field.fileUploadFailed, description: errorMessage(err), tone: "danger" });
                          } finally {
                            setBusyKey(null);
                            e.target.value = "";
                          }
                        }}
                      />
                      {docs.length > 0 ? (
                        <Select
                          value=""
                          small
                          aria-label={m.apply.todo.field.selectExisting}
                          onChange={(e) => {
                            const doc = docs.find((x) => x.key === e.target.value);
                            if (doc) setDraft(row.jobId, q.key, { value: doc.path, fileName: doc.filename });
                          }}
                          style={{ maxWidth: 260 }}
                        >
                          <option value="">{m.apply.todo.field.orSelectExisting}</option>
                          {docs.map((dd) => (
                            <option key={dd.key} value={dd.key}>
                              {documentLabel(dd.key, lang)} · {dd.filename}
                            </option>
                          ))}
                        </Select>
                      ) : null}
                    </div>
                  )}
                </Field>
              );
            }

            if (q.options && q.options.length > 0 && q.multiple) {
              const chosen = new Set(d.value.split(MULTI_SEP).map((s) => s.trim()).filter(Boolean));
              return (
                <Field key={q.key} label={label} hint={q.hint}>
                  <div className="row">
                    {q.options.map((o) => (
                      <Checkbox
                        key={o}
                        label={o}
                        checked={chosen.has(o)}
                        onChange={(e) => {
                          const next = new Set(chosen);
                          if (e.target.checked) next.add(o);
                          else next.delete(o);
                          setDraft(row.jobId, q.key, { value: q.options!.filter((x) => next.has(x)).join(MULTI_SEP) });
                        }}
                      />
                    ))}
                    <Checkbox label={m.apply.todo.field.onlyOnce} checked={d.onlyOnce} onChange={(e) => setDraft(row.jobId, q.key, { onlyOnce: e.target.checked })} />
                  </div>
                </Field>
              );
            }

            return (
              <Field key={q.key} htmlFor={id} label={label} hint={q.hint}>
                <div className="row row-nowrap">
                  {q.options && q.options.length > 0 ? (
                    <Select id={id} value={d.value} onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })} style={{ maxWidth: 360 }}>
                      <option value="">{m.apply.todo.field.choose}</option>
                      {q.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input id={id} value={d.value} placeholder={m.apply.todo.field.answerPlaceholder} onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })} style={{ maxWidth: 480 }} />
                  )}
                  <Checkbox label={m.apply.todo.field.onlyOnce} checked={d.onlyOnce} onChange={(e) => setDraft(row.jobId, q.key, { onlyOnce: e.target.checked })} />
                </div>
              </Field>
            );
          })}
        </div>

        <div className="row mt-4">
          <Button variant="primary" onClick={() => submit(row)} loading={busyKey === `submit-${row.jobId}`} disabled={missing || (busyKey !== null && busyKey !== `submit-${row.jobId}`)}>
            {m.apply.todo.submitButton}
          </Button>
          {row.status !== "needs_info" || !applyRunning ? (
            <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={() => retry(row)} loading={busyKey === `retry-${row.jobId}`} disabled={busyKey !== null && busyKey !== `retry-${row.jobId}`}>
              {m.apply.todo.retryForm}
            </Button>
          ) : null}
          {skipButton(row)}
          {missing ? <span className="muted small">{m.apply.todo.missingRequired}</span> : null}
        </div>
      </Card>,
    ];
  });

  if (compact) return rows.length === 0 ? null : <div className="col gap-3">{cards}</div>;

  return (
    <Section id="todo" title={m.apply.todo.sectionTitle} count={rows.length > 0 ? rows.length : undefined} description={m.apply.todo.sectionDescription}>
      {rows.length === 0 ? (
        <EmptyState compact title={m.apply.todo.emptyTitle} description={m.apply.todo.emptyDescription} />
      ) : (
        <>
          <div className="col gap-3">{cards}</div>
          <p className="muted xs mt-3">
            <MessageSquare size={12} aria-hidden /> {m.apply.todo.footnote}
          </p>
        </>
      )}
    </Section>
  );
}
