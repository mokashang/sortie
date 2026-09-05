"use client";
import { useState } from "react";

interface Row {
  key: string;
  value: string;
}

// Keys the apply executor looks for first when an application form asks something the contact/
// education/work-auth/EEO blocks don't cover. Shown as one-click "add" chips so the user never
// has to remember the spelling; anything else can be added as a free key.
const SUGGESTED: { key: string; hint: string }[] = [
  { key: "high_school", hint: "高中名称(Palantir 等会问)" },
  { key: "high_school_grad_year", hint: "高中毕业年份" },
  { key: "relocation", hint: "愿意搬去的城市,如 New York, Boston" },
  { key: "intern_onsite_availability", hint: "能否在学期中全职驻场实习(是/否 + 说明)" },
  { key: "internship_pushes_graduation", hint: "实习会不会推迟毕业(No)" },
  { key: "intern_important_factors", hint: "实习最看重的因素(最多 3 个)" },
  { key: "summer_2026_plan", hint: "2026 夏天安排" },
  { key: "languages_spoken", hint: "语言能力,如 English, Mandarin" },
  { key: "why_company_note", hint: "写「为什么想来贵司」时希望强调的方向" },
];

export function StandardAnswersEditor({ initial }: { initial: Record<string, string> }) {
  const [rows, setRows] = useState<Row[]>(Object.entries(initial).map(([key, value]) => ({ key, value })));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add(key = "") {
    if (key && rows.some((r) => r.key === key)) return;
    setRows((prev) => [...prev, { key, value: "" }]);
  }

  async function save() {
    setBusy(true);
    setMsg("");
    setError("");
    try {
      const answers: Record<string, string> = {};
      for (const r of rows) if (r.key.trim()) answers[r.key.trim()] = r.value;
      const res = await fetch("/api/profile/standard-answers", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`保存失败:${j.error ?? res.status}`);
        return;
      }
      setRows(Object.entries(j.answers ?? answers).map(([key, value]) => ({ key, value: String(value) })));
      setMsg("已保存到 profile.yaml,下一次填表即生效。");
    } catch (e) {
      setError(`保存失败:${e}`);
    } finally {
      setBusy(false);
    }
  }

  const existing = new Set(rows.map((r) => r.key));

  return (
    <section className="panel" style={{ marginTop: 24 }}>
      <div className="panel-title">标准答案(网申常见题)</div>
      <p className="panel-sub">
        执行器填表时,联系方式/教育/工作授权/EEO 之外的问题都从这里取。遇到这里没有的必填题,它会把申请标为「需人工」并在原因里写明缺哪道题,你在这里补上后点「重试」即可——不会在 Claude 会话里问你。
      </p>
      {error && <p className="text-accent">{error}</p>}
      {msg && <p className="text-good">{msg}</p>}
      <table>
        <thead>
          <tr>
            <th style={{ width: 260 }}>键</th>
            <th>答案</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <input
                  value={r.key}
                  onChange={(e) => update(i, { key: e.target.value })}
                  placeholder="如 high_school"
                  style={{ width: "100%" }}
                  className="mono"
                />
              </td>
              <td>
                <input
                  value={r.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder="答案"
                  style={{ width: "100%" }}
                />
              </td>
              <td>
                <button className="btn-ghost" onClick={() => remove(i)} style={{ fontSize: 12, padding: "4px 10px" }}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {SUGGESTED.filter((s) => !existing.has(s.key)).map((s) => (
          <button
            key={s.key}
            className="btn-ghost"
            onClick={() => add(s.key)}
            title={s.hint}
            style={{ fontSize: 12, padding: "3px 10px" }}
          >
            + {s.key}
          </button>
        ))}
        <button className="btn-ghost" onClick={() => add()} style={{ fontSize: 12, padding: "3px 10px" }}>
          + 自定义
        </button>
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={save} disabled={busy}>
          保存标准答案
        </button>
      </div>
    </section>
  );
}
