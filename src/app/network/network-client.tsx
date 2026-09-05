"use client";
import { useCallback, useEffect, useState } from "react";

// Mirrors src/network/crm.ts's RELATIONS/PLAYBOOKS/CHANNELS — duplicated here (not imported)
// because crm.ts pulls in @/lib/db (better-sqlite3, a native Node module) which cannot be
// bundled into a "use client" component for the browser.
const RELATIONS = ["recruiter", "alum", "hiring_manager", "engineer", "other"] as const;
// 'referral' is deliberately absent: referral requests are created and approved on /apply's
// 内推进行中 board (src/app/apply/referral-panel.tsx), never from this page.
const PLAYBOOKS = [
  "coffee_chat",
  "hidden_opportunity",
  "self_pitch",
  "recruiter",
  "followup",
  "thanks",
] as const;
const CHANNELS = ["linkedin", "email"] as const;

const PLAYBOOK_LABELS: Record<string, string> = {
  referral: "内推(referral)",
  self_pitch: "主动毛遂自荐(self_pitch)",
  recruiter: "已投递给招聘方(recruiter)",
  coffee_chat: "请教 15 分钟(coffee_chat)",
  hidden_opportunity: "探索性请教(hidden_opportunity)",
  followup: "礼貌跟进(followup)",
  thanks: "面试后感谢(thanks)",
};

const RELATION_LABELS: Record<string, string> = {
  recruiter: "招聘方",
  alum: "校友",
  hiring_manager: "用人经理",
  engineer: "工程师",
  other: "其他",
};

interface Person {
  id: number;
  name: string;
  company: string | null;
  role_title: string | null;
  linkedin_url: string | null;
  email: string | null;
  relation: string | null;
}

interface ThreadEntry {
  at: string;
  dir: "sent" | "received";
  text: string;
}

interface OutreachRow {
  id: number;
  personId: number;
  personName: string;
  personCompany: string | null;
  jobId: number | null;
  playbook: string;
  channel: string;
  draft: string | null;
  threadLog: ThreadEntry[];
  status: string;
  outcome: string | null;
  createdAt: string;
}

interface SendableRow {
  id: number;
  personId: number;
  personName: string;
  linkedinUrl: string | null;
  email: string | null;
  channel: string;
  playbook: string;
  draft: string | null;
  jobId: number | null;
}

interface JobLite {
  id: number;
  company: string;
  title: string;
}

function parseEmailDraft(draft: string): { subject: string; body: string } {
  const m = draft.match(/^Subject: (.*)\n\n([\s\S]*)$/);
  if (m) return { subject: m[1], body: m[2] };
  return { subject: "", body: draft };
}

async function postJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ? String(j.error) : `HTTP ${r.status}`);
  return j;
}

async function putJson(url: string, body: unknown) {
  const r = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ? String(j.error) : `HTTP ${r.status}`);
  return j;
}

export function NetworkClient() {
  const [people, setPeople] = useState<Person[]>([]);
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [draftRows, setDraftRows] = useState<OutreachRow[]>([]);
  const [pendingRows, setPendingRows] = useState<SendableRow[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [selectedOutreach, setSelectedOutreach] = useState<OutreachRow[]>([]);
  const [editedDrafts, setEditedDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const [addForm, setAddForm] = useState({
    name: "",
    company: "",
    role_title: "",
    linkedin_url: "",
    email: "",
    relation: "",
  });
  const [addBusy, setAddBusy] = useState(false);

  const [genForm, setGenForm] = useState({ personId: "", playbook: "coffee_chat", jobId: "", channel: "linkedin" });
  const [genBusy, setGenBusy] = useState(false);

  const [actionBusyId, setActionBusyId] = useState<number | null>(null);

  const jobMap = new Map(jobs.map((j) => [j.id, j]));

  const refreshAll = useCallback(async () => {
    try {
      const [peopleRes, draftRes, pendingRes] = await Promise.all([
        fetch("/api/network/people").then((r) => r.json()),
        fetch("/api/network/outreach?status=draft&jobLinked=false").then((r) => r.json()),
        fetch("/api/network/sendables?jobLinked=false").then((r) => r.json()),
      ]);
      setPeople(peopleRes.people ?? []);
      const drafts: OutreachRow[] = draftRes.outreach ?? [];
      setDraftRows(drafts);
      setEditedDrafts((prev) => {
        const next = { ...prev };
        for (const row of drafts) {
          if (!(row.id in next)) next[row.id] = row.draft ?? "";
        }
        return next;
      });
      setPendingRows(pendingRes.sendables ?? []);
    } catch {
      // transient network hiccup during polling — keep showing the last known lists
    }
  }, []);

  const refreshSelected = useCallback(async (personId: number) => {
    try {
      const r = await fetch(`/api/network/outreach?personId=${personId}`);
      const j = await r.json();
      setSelectedOutreach(j.outreach ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetch("/api/jobs?all=1")
      .then((r) => r.json())
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshAll();
    const id = setInterval(refreshAll, 5000);
    return () => clearInterval(id);
  }, [refreshAll]);

  useEffect(() => {
    if (selectedPersonId != null) refreshSelected(selectedPersonId);
  }, [selectedPersonId, refreshSelected]);

  async function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!addForm.name.trim()) return;
    setAddBusy(true);
    setError("");
    try {
      await postJson("/api/network/people", {
        name: addForm.name.trim(),
        company: addForm.company.trim() || null,
        role_title: addForm.role_title.trim() || null,
        linkedin_url: addForm.linkedin_url.trim() || null,
        email: addForm.email.trim() || null,
        relation: addForm.relation || null,
        source: "manual",
      });
      setAddForm({ name: "", company: "", role_title: "", linkedin_url: "", email: "", relation: "" });
      await refreshAll();
    } catch (e) {
      setError(`添加失败:${e}`);
    } finally {
      setAddBusy(false);
    }
  }

  async function submitGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!genForm.personId) {
      setError("请先选择联系人");
      return;
    }
    setGenBusy(true);
    setError("");
    try {
      await postJson("/api/network/draft", {
        personId: Number(genForm.personId),
        playbook: genForm.playbook,
        jobId: genForm.jobId ? Number(genForm.jobId) : undefined,
        channel: genForm.channel,
      });
      await refreshAll();
      if (selectedPersonId != null) await refreshSelected(selectedPersonId);
    } catch (e) {
      setError(`生成草稿失败:${e}`);
    } finally {
      setGenBusy(false);
    }
  }

  async function approve(row: OutreachRow) {
    setActionBusyId(row.id);
    setError("");
    try {
      const edited = editedDrafts[row.id] ?? row.draft ?? "";
      if (edited !== (row.draft ?? "")) {
        await putJson("/api/network/outreach", { outreachId: row.id, draft: edited });
      }
      await postJson("/api/network/decide", { outreachId: row.id, decision: "approve" });
      await refreshAll();
      if (selectedPersonId != null) await refreshSelected(selectedPersonId);
    } catch (e) {
      setError(`批准失败:${e}`);
    } finally {
      setActionBusyId(null);
    }
  }

  async function reject(row: OutreachRow) {
    setActionBusyId(row.id);
    setError("");
    try {
      await postJson("/api/network/decide", { outreachId: row.id, decision: "reject" });
      await refreshAll();
      if (selectedPersonId != null) await refreshSelected(selectedPersonId);
    } catch (e) {
      setError(`拒绝失败:${e}`);
    } finally {
      setActionBusyId(null);
    }
  }

  async function markSent(outreachId: number) {
    setActionBusyId(outreachId);
    setError("");
    try {
      await postJson("/api/network/report", { outreachId, event: "sent" });
      await refreshAll();
      if (selectedPersonId != null) await refreshSelected(selectedPersonId);
    } catch (e) {
      setError(`标记失败:${e}`);
    } finally {
      setActionBusyId(null);
    }
  }

  async function recordOutcome(outreachId: number, outcome: "meeting" | "referral_won" | "no_response") {
    setActionBusyId(outreachId);
    setError("");
    try {
      await postJson("/api/network/outcome", { outreachId, outcome });
      await refreshAll();
      if (selectedPersonId != null) await refreshSelected(selectedPersonId);
    } catch (e) {
      setError(`记录结果失败:${e}`);
    } finally {
      setActionBusyId(null);
    }
  }

  const selectedPerson = people.find((p) => p.id === selectedPersonId) ?? null;
  const linkedJobIds = Array.from(new Set(selectedOutreach.map((o) => o.jobId).filter((x): x is number => x != null)));

  return (
    <div>
      {error && <p className="text-accent">{error}</p>}

      {/* ---- AI 草稿生成入口 ---- */}
      <section className="panel">
        <div className="panel-title">AI 草稿</div>
        <form onSubmit={submitGenerate} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select
            value={genForm.personId}
            onChange={(e) => setGenForm({ ...genForm, personId: e.target.value })}
            required
          >
            <option value="">选择联系人…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.company ? ` · ${p.company}` : ""}
              </option>
            ))}
          </select>
          <select value={genForm.playbook} onChange={(e) => setGenForm({ ...genForm, playbook: e.target.value })}>
            {PLAYBOOKS.map((pb) => (
              <option key={pb} value={pb}>
                {PLAYBOOK_LABELS[pb]}
              </option>
            ))}
          </select>
          <select value={genForm.channel} onChange={(e) => setGenForm({ ...genForm, channel: e.target.value })}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <button type="submit" disabled={genBusy}>
            {genBusy ? "生成中…(最长约 30 秒)" : "AI 草稿"}
          </button>
        </form>
      </section>

      {/* ---- 草稿审批区 ---- */}
      <section className="panel">
        <div className="panel-title">草稿审批 ({draftRows.length})</div>
        {draftRows.length === 0 ? (
          <p className="text-sub">暂无待审批草稿。</p>
        ) : (
          draftRows.map((row) => (
            <div key={row.id} className="card">
              <div className="text-sub" style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>
                  收件人:<strong className="company-name">{row.personName}</strong>
                  {row.personCompany ? ` · ${row.personCompany}` : ""} · {PLAYBOOK_LABELS[row.playbook] ?? row.playbook} ·{" "}
                  {row.channel}
                </span>
              </div>
              <textarea
                value={editedDrafts[row.id] ?? row.draft ?? ""}
                onChange={(e) => setEditedDrafts((prev) => ({ ...prev, [row.id]: e.target.value }))}
                rows={6}
                style={{ width: "100%", marginTop: 8, fontFamily: "inherit", fontSize: 14, padding: 8 }}
              />
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button onClick={() => approve(row)} disabled={actionBusyId === row.id}>
                  批准发送
                </button>
                <button className="btn-ghost" onClick={() => reject(row)} disabled={actionBusyId === row.id}>
                  拒绝
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* ---- 待发送 / 已批准 ---- */}
      <section className="panel">
        <div className="panel-title">已批准 ({pendingRows.length})</div>
        {pendingRows.length === 0 ? (
          <p className="text-sub">暂无。</p>
        ) : (
          pendingRows.map((row) => {
            const parsed = row.channel === "email" && row.draft ? parseEmailDraft(row.draft) : null;
            const mailtoHref =
              row.channel === "email" && row.email
                ? `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(
                    parsed?.subject ?? ""
                  )}&body=${encodeURIComponent(parsed?.body ?? row.draft ?? "")}`
                : null;
            return (
              <div key={row.id} className="card">
                <div className="text-sub" style={{ fontSize: 13 }}>
                  收件人:<strong className="company-name">{row.personName}</strong> · {PLAYBOOK_LABELS[row.playbook] ?? row.playbook} · {row.channel}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 14, margin: "8px 0" }}>
                  {row.draft}
                </pre>
                {row.channel === "linkedin" ? (
                  <p className="text-warn" style={{ fontWeight: 600 }}>待执行器发送</p>
                ) : (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {mailtoHref ? (
                      <a href={mailtoHref}>
                        <button type="button">打开邮件</button>
                      </a>
                    ) : (
                      <span className="text-sub">(联系人无邮箱)</span>
                    )}
                    <button className="btn-ghost" onClick={() => markSent(row.id)} disabled={actionBusyId === row.id}>
                      标记已发
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* ---- 联系人区 ---- */}
      <section style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 360px", minWidth: 320 }} className="panel">
          <div className="panel-title">联系人 ({people.length})</div>
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>公司</th>
                <th>关系</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr
                  key={p.id}
                  style={{ cursor: "pointer", background: p.id === selectedPersonId ? "var(--chip-bg)" : undefined }}
                  onClick={() => setSelectedPersonId(p.id)}
                >
                  <td>{p.name}</td>
                  <td>{p.company ?? "—"}</td>
                  <td>{RELATION_LABELS[p.relation ?? ""] ?? p.relation ?? "—"}</td>
                  <td>
                    {p.linkedin_url ? (
                      <a href={p.linkedin_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        LinkedIn
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <details style={{ marginTop: 16 }}>
            <summary>手动添加联系人</summary>
            <form onSubmit={submitAdd} style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, maxWidth: 360 }}>
              <input
                placeholder="姓名 *"
                value={addForm.name}
                onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
                required
              />
              <input
                placeholder="公司"
                value={addForm.company}
                onChange={(e) => setAddForm({ ...addForm, company: e.target.value })}
              />
              <input
                placeholder="职位"
                value={addForm.role_title}
                onChange={(e) => setAddForm({ ...addForm, role_title: e.target.value })}
              />
              <input
                placeholder="LinkedIn URL"
                value={addForm.linkedin_url}
                onChange={(e) => setAddForm({ ...addForm, linkedin_url: e.target.value })}
              />
              <input
                placeholder="Email"
                value={addForm.email}
                onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
              />
              <select value={addForm.relation} onChange={(e) => setAddForm({ ...addForm, relation: e.target.value })}>
                <option value="">关系…</option>
                {RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {RELATION_LABELS[r]}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={addBusy}>
                添加
              </button>
            </form>
          </details>
        </div>

        <div style={{ flex: "2 1 480px", minWidth: 320 }} className="panel">
          <div className="panel-title">联系人详情</div>
          {!selectedPerson ? (
            <p className="text-sub">点选左侧联系人查看历史。</p>
          ) : (
            <div>
              <div style={{ marginBottom: 8 }}>
                <strong className="company-name">{selectedPerson.name}</strong>
                {selectedPerson.company ? ` · ${selectedPerson.company}` : ""}
                {selectedPerson.role_title ? ` · ${selectedPerson.role_title}` : ""}
              </div>
              <div className="text-sub" style={{ fontSize: 13, marginBottom: 12 }}>
                关联岗位:
                {linkedJobIds.length === 0
                  ? " —"
                  : linkedJobIds.map((jid) => (jobMap.has(jid) ? ` ${jobMap.get(jid)!.company}·${jobMap.get(jid)!.title}` : ` #${jid}`)).join(",")}
              </div>

              <h4>Outreach 历史</h4>
              {selectedOutreach.length === 0 ? (
                <p className="text-sub">暂无记录。</p>
              ) : (
                selectedOutreach.map((row) => (
                  <div key={row.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
                    <div className="text-sub" style={{ fontSize: 13 }}>
                      {PLAYBOOK_LABELS[row.playbook] ?? row.playbook} · {row.channel} · 状态:{row.status}
                      {row.outcome ? ` (${row.outcome})` : ""} · <span className="mono">{row.createdAt.slice(0, 16)}</span>
                    </div>
                    {row.threadLog.length === 0 ? (
                      <p className="text-sub" style={{ fontSize: 13 }}>(尚无消息记录)</p>
                    ) : (
                      <ul style={{ listStyle: "none", marginTop: 6 }}>
                        {row.threadLog.map((t, i) => (
                          <li key={i} style={{ fontSize: 13, margin: "4px 0" }}>
                            <span className={t.dir === "sent" ? "text-good" : "text-accent"} style={{ fontWeight: 600 }}>
                              {t.dir === "sent" ? "→ 发送" : "← 收到"}
                            </span>{" "}
                            <span className="text-sub mono">{t.at.slice(0, 16)}</span>
                            <div style={{ whiteSpace: "pre-wrap" }}>{t.text}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {(row.status === "sent" || row.status === "replied") && (
                      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                        <button className="btn-ghost" onClick={() => recordOutcome(row.id, "meeting")} disabled={actionBusyId === row.id}>
                          约到了
                        </button>
                        <button className="btn-ghost" onClick={() => recordOutcome(row.id, "referral_won")} disabled={actionBusyId === row.id}>
                          拿到内推
                        </button>
                        <button className="btn-ghost" onClick={() => recordOutcome(row.id, "no_response")} disabled={actionBusyId === row.id}>
                          无回应
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
