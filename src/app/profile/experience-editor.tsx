"use client";
import { useState } from "react";

interface Bullet { text: string; directions: string[] }
interface Exp {
  id?: number; kind: string; title: string; organization?: string | null; location?: string | null;
  start_date?: string | null; end_date?: string | null; bullets: Bullet[]; sort_order: number;
}
const KINDS = ["education", "work", "project", "skill", "award", "publication"];
const blank = (): Exp => ({ kind: "work", title: "", organization: "", location: "", start_date: "", end_date: "", bullets: [], sort_order: 0 });

export function ExperienceEditor({ initial }: { initial: Exp[] }) {
  const [items, setItems] = useState<Exp[]>(initial);
  const [draft, setDraft] = useState<Exp>(blank());
  const [msg, setMsg] = useState("");

  async function save(exp: Exp) {
    const isNew = !exp.id;
    const res = await fetch(isNew ? "/api/experiences" : `/api/experiences/${exp.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(exp),
    });
    if (!res.ok) { setMsg("保存失败:" + res.status); return; }
    setMsg("已保存");
    const list = await (await fetch("/api/experiences")).json();
    setItems(list.experiences);
    setDraft(blank());
  }
  async function remove(id: number) {
    await fetch(`/api/experiences/${id}`, { method: "DELETE" });
    setItems(items.filter((i) => i.id !== id));
  }
  function setDraftBullet(i: number, text: string) {
    const b = [...draft.bullets]; b[i] = { text, directions: b[i]?.directions ?? [] }; setDraft({ ...draft, bullets: b });
  }

  return (
    <div>
      <div style={{ background: "#fff", padding: 16, borderRadius: 8, marginBottom: 20 }}>
        <h3>添加一条经历</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="标题(职位/项目/学位)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <input placeholder="机构" value={draft.organization ?? ""} onChange={(e) => setDraft({ ...draft, organization: e.target.value })} />
          <input placeholder="地点" value={draft.location ?? ""} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
          <input placeholder="开始 (2025-06)" value={draft.start_date ?? ""} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} />
          <input placeholder="结束 (Present)" value={draft.end_date ?? ""} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} />
        </div>
        <div>
          {draft.bullets.map((b, i) => (
            <input key={i} style={{ width: "100%", margin: "3px 0" }} placeholder={`bullet ${i + 1}`} value={b.text} onChange={(e) => setDraftBullet(i, e.target.value)} />
          ))}
          <button onClick={() => setDraft({ ...draft, bullets: [...draft.bullets, { text: "", directions: [] }] })}>+ bullet</button>
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={() => save(draft)} disabled={!draft.title}>保存经历</button> <span style={{ color: "#666" }}>{msg}</span>
        </div>
      </div>

      {KINDS.filter((k) => items.some((i) => i.kind === k)).map((k) => (
        <div key={k}>
          <h3 style={{ marginTop: 16, textTransform: "capitalize" }}>{k}</h3>
          {items.filter((i) => i.kind === k).map((e) => (
            <div key={e.id} style={{ background: "#fff", padding: 12, borderRadius: 6, marginBottom: 8 }}>
              <b>{e.title}</b> {e.organization && `· ${e.organization}`} {e.start_date && <span style={{ color: "#888" }}>({e.start_date}{e.end_date ? `–${e.end_date}` : ""})</span>}
              <button style={{ float: "right" }} onClick={() => remove(e.id!)}>删除</button>
              <ul style={{ margin: "6px 0 0 18px", fontSize: 13 }}>
                {e.bullets.map((b, i) => <li key={i}>{b.text}</li>)}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
