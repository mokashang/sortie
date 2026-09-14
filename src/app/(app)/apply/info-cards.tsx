"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, MessageSquare, RotateCcw, Trash, UserCheck } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { INFO_KIND_LABEL, documentLabel } from "@/app/lib/labels";
import { Button, Card, Checkbox, Chip, EmptyState, Field, Input, LinkButton, Section, Select, Tooltip, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";

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

function continueText(j: Continued): string {
  if (j.status === "prepared") return "助手会接着填这份表单。";
  return j.autoStarted ? "已重新排队,助手马上接着投。" : "已放回队列,助手正忙,这一轮或下一轮会带上。";
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
  return (
    <div className="row between">
      <div className="grow">
        <div className="confirm-title">
          <span className="serif strong">{row.company}</span>
          <span className="muted"> · </span>
          <span>{row.title}</span>
        </div>
        <div className="row mt-2">
          <Chip>{row.direction ? directionLabel(row.direction) : "未分类"}</Chip>
          <Chip tone="accent">{kindLabel}</Chip>
          {row.status === "needs_info" && waiting ? (
            <Chip tone="warn">助手等待中 · {row.askedAt}</Chip>
          ) : row.status === "needs_info" ? (
            <Chip tone="neutral">助手已离开 · 处理完自动重新排队</Chip>
          ) : (
            <Chip tone="neutral" title={row.needsManualReason ?? undefined}>
              已暂停 · 处理完自动继续
            </Chip>
          )}
        </div>
      </div>
      {row.applyUrl ? (
        <LinkButton href={row.applyUrl} external size="sm" variant="ghost">
          看职位
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
        toast({ title: `已提交 ${row.company} 的答案`, description: continueText(j), tone: "good" });
      } catch (e) {
        toast({ title: "提交失败", description: errorMessage(e), tone: "danger" });
      }
    });
  }

  async function loginDone(host: string, count: number) {
    await run(`login-${host}`, async () => {
      try {
        const j = await postJson<Continued & { jobIds?: number[] }>("/api/apply/login-done", { host });
        const n = j.jobIds?.length ?? count;
        toast({ title: `${host} 已放行 ${n} 个岗位`, description: continueText(j), tone: "good" });
      } catch (e) {
        toast({ title: "没能放行", description: errorMessage(e), tone: "danger" });
      }
    });
  }

  async function retry(row: InfoRow) {
    await run(`retry-${row.jobId}`, async () => {
      try {
        const j = await postJson<Continued>("/api/apply/unpark", { jobId: row.jobId });
        toast({ title: `${row.company} 已交回助手`, description: continueText(j), tone: "good" });
      } catch (e) {
        toast({ title: "没能重试", description: errorMessage(e), tone: "danger" });
      }
    });
  }

  async function selfSubmitted(row: InfoRow) {
    await run(`self-${row.jobId}`, async () => {
      try {
        await postJson("/api/apply/self-submitted", { jobId: row.jobId });
        toast({ title: `已记下:${row.company} 你自己投了`, description: "进了投递历史,后续 OA / 面试在历史页改状态。", tone: "good" });
      } catch (e) {
        toast({ title: "没能记录", description: errorMessage(e), tone: "danger" });
      }
    });
  }

  async function skip(row: InfoRow) {
    await run(`skip-${row.jobId}`, async () => {
      try {
        await postJson("/api/apply/archive-manual", { jobIds: [row.jobId] });
        toast({
          title: `已跳过 ${row.company} · ${row.title}`,
          description: "已归档,不再投递。",
          action: {
            label: "撤销",
            onClick: () => {
              postJson("/api/queue/unarchive", { jobId: row.jobId })
                .then(async () => {
                  toast({ title: "已恢复到队列", tone: "good" });
                  await refresh();
                  await refreshOverview();
                })
                .catch((e) => toast({ title: "撤销失败", description: errorMessage(e), tone: "danger" }));
            },
          },
        });
      } catch (e) {
        toast({ title: "没能跳过", description: errorMessage(e), tone: "danger" });
      }
    });
  }

  const skipButton = (row: InfoRow) => (
    <Button size="sm" variant="ghost" icon={<Trash size={13} />} onClick={() => skip(row)} loading={busyKey === `skip-${row.jobId}`} disabled={busyKey !== null && busyKey !== `skip-${row.jobId}`}>
      跳过这个岗
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
                <Chip tone="accent">{INFO_KIND_LABEL.login}</Chip>
                <Chip tone="neutral">已暂停 · 登完自动继续</Chip>
                {group.item.host ? <Chip outline>{group.item.host}</Chip> : null}
              </div>
            </div>
          </div>
          {group.item.hint ? <p className="muted small todo-hint mt-3">{group.item.hint}</p> : null}
          <p className="muted small mt-3">
            在你的求职 Chrome 里登录或注册一次就够了,Chrome 会记住会话;助手不会替你输入密码。登完点下面的按钮,这些岗位会自动继续。
          </p>
          <ul className="todo-jobs mt-3">
            {group.rows.map((r) => (
              <li key={r.jobId} className="todo-job">
                <span className="serif strong">{r.company}</span>
                <span className="muted">·</span>
                <span className="truncate">{r.title}</span>
                <Chip outline>{r.direction ? directionLabel(r.direction) : "未分类"}</Chip>
                <span className="grow" />
                {skipButton(r)}
              </li>
            ))}
          </ul>
          <div className="row mt-4">
            {group.item.url ? (
              <LinkButton href={group.item.url} external icon={<ExternalLink size={14} />}>
                打开登录页
              </LinkButton>
            ) : null}
            <Button variant="primary" icon={<Check size={14} />} onClick={() => loginDone(host, group.rows.length)} loading={busy} disabled={busyKey !== null && !busy}>
              我登好了,继续
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
          <Head row={row} kindLabel={INFO_KIND_LABEL.manual} waiting={applyRunning} />
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
                {isExternal(url) ? "打开申请页" : "去处理"}
              </LinkButton>
            ) : null}
            <Button variant={retryPrimary ? "primary" : "secondary"} icon={<RotateCcw size={14} />} onClick={() => retry(row)} loading={busyKey === `retry-${row.jobId}`} disabled={busyKey !== null && busyKey !== `retry-${row.jobId}`}>
              让助手再试一次
            </Button>
            <Button icon={<UserCheck size={14} />} onClick={() => selfSubmitted(row)} loading={busyKey === `self-${row.jobId}`} disabled={busyKey !== null && busyKey !== `self-${row.jobId}`}>
              我自己投完了
            </Button>
            {skipButton(row)}
          </div>
        </Card>,
      ];
    }

    const answerable = row.questions.filter((q) => kindOf(q) !== "login" && kindOf(q) !== "manual");
    const missing = answerable.some((q) => !q.optional && !draft(row.jobId, q.key).value.trim());
    const kinds = new Set(answerable.map(kindOf));
    const kindLabel = kinds.has("file") ? INFO_KIND_LABEL.file : kinds.has("action") ? INFO_KIND_LABEL.action : INFO_KIND_LABEL.text;
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
                {q.optional ? <span className="muted xs">(可选)</span> : null}
                {kind === "text" ? <Tooltip content={`答案会以「${q.key}」存进标准答案,下次自动填`} /> : null}
                {kind === "file" ? <Tooltip content={`存为档案里的文件「${documentLabel(q.key)}」,以后要它的表单都自动上传`} /> : null}
              </>
            );

            if (kind === "action") {
              return (
                <Field key={q.key} label={label} hint={q.hint}>
                  <Checkbox label="完成了" checked={d.value === "done"} onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.checked ? "done" : "" })} />
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
                        换一个
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
                            toast({ title: `已上传 ${documentLabel(q.key)}`, description: "存进了档案的文件里,以后自动用。", tone: "good" });
                          } catch (err) {
                            toast({ title: "上传失败", description: errorMessage(err), tone: "danger" });
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
                          aria-label="选已有文件"
                          onChange={(e) => {
                            const doc = docs.find((x) => x.key === e.target.value);
                            if (doc) setDraft(row.jobId, q.key, { value: doc.path, fileName: doc.filename });
                          }}
                          style={{ maxWidth: 260 }}
                        >
                          <option value="">或选已有文件…</option>
                          {docs.map((dd) => (
                            <option key={dd.key} value={dd.key}>
                              {documentLabel(dd.key)} · {dd.filename}
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
                    <Checkbox label="仅本次" checked={d.onlyOnce} onChange={(e) => setDraft(row.jobId, q.key, { onlyOnce: e.target.checked })} />
                  </div>
                </Field>
              );
            }

            return (
              <Field key={q.key} htmlFor={id} label={label} hint={q.hint}>
                <div className="row row-nowrap">
                  {q.options && q.options.length > 0 ? (
                    <Select id={id} value={d.value} onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })} style={{ maxWidth: 360 }}>
                      <option value="">选择…</option>
                      {q.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input id={id} value={d.value} placeholder="你的答案" onChange={(e) => setDraft(row.jobId, q.key, { value: e.target.value })} style={{ maxWidth: 480 }} />
                  )}
                  <Checkbox label="仅本次" checked={d.onlyOnce} onChange={(e) => setDraft(row.jobId, q.key, { onlyOnce: e.target.checked })} />
                </div>
              </Field>
            );
          })}
        </div>

        <div className="row mt-4">
          <Button variant="primary" onClick={() => submit(row)} loading={busyKey === `submit-${row.jobId}`} disabled={missing || (busyKey !== null && busyKey !== `submit-${row.jobId}`)}>
            提交答案,继续投递
          </Button>
          {row.status !== "needs_info" || !applyRunning ? (
            <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={() => retry(row)} loading={busyKey === `retry-${row.jobId}`} disabled={busyKey !== null && busyKey !== `retry-${row.jobId}`}>
              让助手重新来
            </Button>
          ) : null}
          {skipButton(row)}
          {missing ? <span className="muted small">还有必填项没填。</span> : null}
        </div>
      </Card>,
    ];
  });

  if (compact) return rows.length === 0 ? null : <div className="col gap-3">{cards}</div>;

  return (
    <Section id="todo" title="待处理" count={rows.length > 0 ? rows.length : undefined} description="助手停下来等你的事:补答案、传文件、登录一次,或你亲自完成。做完自动继续。">
      {rows.length === 0 ? (
        <EmptyState compact title="没有等你的事" description="助手需要你补答案、传文件、登录一次,或亲自完成时,会出现在这里;处理完它自己接着投。" />
      ) : (
        <>
          <div className="col gap-3">{cards}</div>
          <p className="muted xs mt-3">
            <MessageSquare size={12} aria-hidden /> 岗位特有的题勾「仅本次」,其余会存进档案的标准答案;文件存进档案的「文件」标签,下次不再问。
          </p>
        </>
      )}
    </Section>
  );
}
