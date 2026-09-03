"use client";
import { useCallback, useEffect, useState } from "react";
import { directionLabel } from "@/matcher/directions";

interface CardJob {
  jobId: number;
  title: string;
  applyUrl: string | null;
  direction: string | null;
  score: number | null;
  status: "referral_seeking" | "referral_ready";
  noContactReason: string | null;
  referralInfo: { source: string; link?: string; code?: string; note?: string; at: string } | null;
  referralPersonName: string | null;
}
interface CardOutreach {
  id: number;
  personId: number;
  personName: string;
  relation: string | null;
  linkedinUrl: string | null;
  channel: string;
  status: string;
  draft: string | null;
  sentAt: string | null;
}
interface Card {
  company: string;
  jobs: CardJob[];
  outreach: CardOutreach | null;
  daysWaiting: number | null;
  overdue: boolean;
}

const RELATION: Record<string, string> = { alum: "校友", recruiter: "招聘方", hiring_manager: "用人经理", engineer: "工程师", other: "其他" };
const OUTREACH_STATUS: Record<string, string> = {
  draft: "草稿待你批准",
  pending_send: "已批准,等值守会话发送",
  sent: "已发出,等回复",
  replied: "已回复",
  referral_won: "已拿到内推",
  no_response: "无回应",
  archived: "草稿已作废",
};

type WonForm = { company: string; jobIds: number[]; personName: string; source: string; link: string; code: string; note: string };

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ? String(j.error) : `HTTP ${r.status}`);
  return j;
}
async function put(url: string, body: unknown) {
  const r = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

// /apply's 内推进行中 board (spec §4.4): one card per company. Polls /api/referral/board every
// 5s so a card advances on its own as the attended session finds people / sends messages.
export function ReferralPanel() {
  const [cards, setCards] = useState<Card[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [won, setWon] = useState<WonForm | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/referral/board");
      if (!r.ok) return;
      const j = await r.json();
      const next: Card[] = j.cards ?? [];
      setCards(next);
      setDrafts((prev) => {
        const d = { ...prev };
        for (const c of next) if (c.outreach && !(c.outreach.id in d)) d[c.outreach.id] = c.outreach.draft ?? "";
        return d;
      });
    } catch {
      // keep last known cards
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function decide(jobIds: number[], action: "direct" | "won" | "retry" | "archive", extra: Record<string, unknown> = {}) {
    setBusy(`${action}-${jobIds.join(",")}`);
    setError("");
    setNotice("");
    try {
      const j = await post("/api/referral/decide", { jobIds, action, ...extra });
      setNotice(
        j.autoStarted
          ? `已入队 run #${j.runId}(${j.channel === "user_chrome" ? "等值守会话接手" : "无人值守"})`
          : j.message ?? "已更新"
      );
      setWon(null);
      await refresh();
    } catch (e) {
      setError(`操作失败:${e}`);
    } finally {
      setBusy(null);
    }
  }

  async function approveDraft(o: CardOutreach) {
    setBusy(`approve-${o.id}`);
    setError("");
    try {
      const edited = drafts[o.id] ?? o.draft ?? "";
      if (edited !== (o.draft ?? "")) await put("/api/network/outreach", { outreachId: o.id, draft: edited });
      const j = await post("/api/network/decide", { outreachId: o.id, decision: "approve" });
      setNotice(j.autoStarted ? `已批准,已入队 run #${j.runId} 等值守会话发送` : "已批准,值守会话会发送");
      await refresh();
    } catch (e) {
      setError(`批准失败:${e}`);
    } finally {
      setBusy(null);
    }
  }

  async function rejectDraft(o: CardOutreach) {
    setBusy(`reject-${o.id}`);
    setError("");
    try {
      await post("/api/network/decide", { outreachId: o.id, decision: "reject" });
      await refresh();
    } catch (e) {
      setError(`拒绝失败:${e}`);
    } finally {
      setBusy(null);
    }
  }

  if (cards.length === 0) {
    return (
      <div>
        {notice && <p className="text-good">{notice}</p>}
        <p className="text-sub">暂无内推进行中的岗位。在上面配额表「找内推」列填份数并开始投递后会出现在这里。</p>
      </div>
    );
  }

  return (
    <div>
      {notice && <p className="text-good">{notice}</p>}
      {error && <p className="text-accent">{error}</p>}
      {cards.map((c) => {
        const ids = c.jobs.map((j) => j.jobId);
        const o = c.outreach;
        const ready = c.jobs.some((j) => j.status === "referral_ready");
        const readyInfo = c.jobs.find((j) => j.referralInfo)?.referralInfo ?? null;
        const noContact = c.jobs.find((j) => j.noContactReason)?.noContactReason ?? null;
        return (
          <div key={c.company} className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
              <strong className="company-name">{c.company}</strong>
              <span className="text-sub" style={{ fontSize: 13 }}>
                {ready ? (
                  <span className="text-good">有内推 · 待投</span>
                ) : o ? (
                  OUTREACH_STATUS[o.status] ?? o.status
                ) : noContact ? (
                  <span className="text-accent">找不到人:{noContact.replace(/^no contact found: /, "")}</span>
                ) : (
                  "值守会话找人中…"
                )}
                {c.daysWaiting != null && (
                  <span className={c.overdue ? "text-accent" : ""} style={{ marginLeft: 8, fontWeight: c.overdue ? 700 : 400 }}>
                    已等 {c.daysWaiting} 天{c.overdue ? " · 建议直接投" : ""}
                  </span>
                )}
              </span>
            </div>
            <ul style={{ margin: "8px 0", paddingLeft: 18, fontSize: 14 }}>
              {c.jobs.map((j) => (
                <li key={j.jobId}>
                  {j.applyUrl ? (
                    <a href={j.applyUrl} target="_blank" rel="noreferrer">
                      {j.title}
                    </a>
                  ) : (
                    j.title
                  )}
                  <span className="chip" style={{ marginLeft: 6 }}>
                    {j.direction ? directionLabel(j.direction) : "未分类"}
                  </span>
                  <span className="text-sub mono" style={{ marginLeft: 6 }}>{j.score ?? "—"}</span>
                  {j.referralInfo && (
                    <span className="text-good" style={{ marginLeft: 6 }}>
                      内推:{j.referralPersonName ?? "—"} · {j.referralInfo.source}
                      {j.referralInfo.link ? " · 有链接" : ""}
                      {j.referralInfo.code ? ` · 码 ${j.referralInfo.code}` : ""}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {o && (
              <div style={{ marginTop: 6 }}>
                <div className="text-sub" style={{ fontSize: 13 }}>
                  联系人:<strong>{o.personName}</strong>
                  {o.relation ? ` · ${RELATION[o.relation] ?? o.relation}` : ""}
                  {o.linkedinUrl && (
                    <>
                      {" · "}
                      <a href={o.linkedinUrl} target="_blank" rel="noreferrer">
                        LinkedIn
                      </a>
                    </>
                  )}
                  {" · "}
                  {o.channel}
                </div>
                {o.status === "draft" ? (
                  <>
                    <textarea
                      value={drafts[o.id] ?? o.draft ?? ""}
                      onChange={(e) => setDrafts((p) => ({ ...p, [o.id]: e.target.value }))}
                      rows={6}
                      style={{ width: "100%", marginTop: 6, fontFamily: "inherit", fontSize: 14, padding: 8 }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button onClick={() => approveDraft(o)} disabled={busy === `approve-${o.id}`}>
                        批准发送
                      </button>
                      <button className="btn-ghost" onClick={() => rejectDraft(o)} disabled={busy === `reject-${o.id}`}>
                        拒绝草稿
                      </button>
                    </div>
                  </>
                ) : (
                  <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 13, margin: "6px 0", background: "var(--chip-bg)", padding: 8 }}>
                    {o.draft}
                  </pre>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {ready ? (
                <button onClick={() => decide(ids, "won", { info: readyInfo })} disabled={!!busy}>
                  开始投(重新入队)
                </button>
              ) : (
                <>
                  <button onClick={() => decide(ids, "direct")} disabled={!!busy}>
                    直接投(不等内推)
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() =>
                      setWon({
                        company: c.company,
                        jobIds: ids,
                        personName: o?.personName ?? "",
                        source: o ? (o.channel === "email" ? "email" : "linkedin") : "wechat",
                        link: "",
                        code: "",
                        note: "",
                      })
                    }
                    disabled={!!busy}
                  >
                    有内推了
                  </button>
                  {o && (o.status === "sent" || o.status === "replied") && (
                    <button className="btn-ghost" onClick={() => decide(ids, "retry")} disabled={!!busy}>
                      换人再问
                    </button>
                  )}
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      if (window.confirm(`放弃 ${c.company} 的这 ${ids.length} 个岗位(归档)?`)) decide(ids, "archive");
                    }}
                    disabled={!!busy}
                  >
                    放弃
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {won && (
        <div
          className="card"
          style={{ position: "fixed", right: 24, bottom: 24, width: 380, zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,.2)", background: "var(--paper, #fff)" }}
        >
          <div className="panel-title">有内推了 · {won.company}</div>
          <label style={{ display: "block", fontSize: 13 }}>
            来源
            <select value={won.source} onChange={(e) => setWon({ ...won, source: e.target.value })} style={{ marginLeft: 8 }}>
              <option value="linkedin">LinkedIn</option>
              <option value="email">邮件</option>
              <option value="wechat">微信</option>
              <option value="other">其他</option>
            </select>
          </label>
          <input placeholder="推荐人姓名 *" value={won.personName} onChange={(e) => setWon({ ...won, personName: e.target.value })} style={{ width: "100%", marginTop: 6 }} />
          <input placeholder="推荐链接(可选,有则用它打开申请页)" value={won.link} onChange={(e) => setWon({ ...won, link: e.target.value })} style={{ width: "100%", marginTop: 6 }} />
          <input placeholder="推荐码(可选)" value={won.code} onChange={(e) => setWon({ ...won, code: e.target.value })} style={{ width: "100%", marginTop: 6 }} />
          <input placeholder="备注(可选)" value={won.note} onChange={(e) => setWon({ ...won, note: e.target.value })} style={{ width: "100%", marginTop: 6 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              disabled={!!busy || !won.personName.trim()}
              onClick={() =>
                decide(won.jobIds, "won", {
                  info: { source: won.source, link: won.link || undefined, code: won.code || undefined, note: won.note || undefined },
                  personName: won.personName.trim(),
                })
              }
            >
              保存并开始投
            </button>
            <button className="btn-ghost" onClick={() => setWon(null)}>
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
