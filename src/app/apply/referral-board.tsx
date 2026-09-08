"use client";
import { useCallback, useEffect, useState } from "react";
import { Handshake, RefreshCw } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson, postJson, putJson, errorMessage } from "@/app/lib/api";
import { OUTREACH_STATUS_LABEL, labelOf } from "@/app/lib/labels";
import { cx } from "@/app/lib/cx";
import { Button, Card, Chip, ConfirmDialog, EmptyState, SkeletonCard, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { ReferralContact, type CardOutreach, type Edited } from "./referral-contact";
import { ReferralWonDialog, type WonInitial } from "./referral-won-dialog";

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

interface ReferralCardData {
  company: string;
  jobs: CardJob[];
  outreaches: CardOutreach[];
  daysWaiting: number | null;
  overdue: boolean;
}

type Action = "direct" | "won" | "retry" | "archive";

const needsAttention = (c: ReferralCardData) =>
  c.jobs.some((j) => j.status === "referral_ready") ||
  c.outreaches.some((o) => o.status === "draft" || o.stage === "will_refer" || o.stage === "referred");

// 内推进行中: one card per company; several contacts per card. Polls every 5s. With
// onlyAttention (the 今日 page) only cards that need the user are shown, and nothing when none do.
export function ReferralBoard({ onlyAttention = false }: { onlyAttention?: boolean }) {
  const [cards, setCards] = useState<ReferralCardData[] | null>(null);
  const [edits, setEdits] = useState<Record<number, Edited>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [won, setWon] = useState<WonInitial | null>(null);
  const [archiveFor, setArchiveFor] = useState<ReferralCardData | null>(null);
  const { refresh: refreshOverview } = useOverview();
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const j = await getJson<{ cards: ReferralCardData[] }>("/api/referral/board");
      const next = j.cards ?? [];
      setCards(next);
      setEdits((prev) => {
        const d = { ...prev };
        for (const c of next) for (const o of c.outreaches) if (!(o.id in d)) d[o.id] = { draft: o.draft ?? "", note: o.draftNote ?? "" };
        return d;
      });
    } catch {
      // keep last known cards
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
      await Promise.all([refresh(), refreshOverview()]);
    } catch (e) {
      toast({ title: "操作失败", description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  function decide(card: ReferralCardData, action: Action, extra: Record<string, unknown> = {}) {
    const ids = card.jobs.map((j) => j.jobId);
    return run(`${action}-${card.company}`, async () => {
      const j = await postJson<{ autoStarted?: boolean; runId?: number; channel?: string; message?: string }>("/api/referral/decide", { jobIds: ids, action, ...extra });
      const titles: Record<Action, string> = { direct: `${card.company} 改为直接投`, won: `${card.company} 开始投递`, retry: `${card.company} 再撒一次网`, archive: `已放弃 ${card.company}` };
      toast({
        title: titles[action],
        description: j.autoStarted ? (j.channel === "user_chrome" ? "已排队,助手接手后开始。" : "后台浏览器已开始。") : j.message ?? undefined,
        tone: action === "archive" ? "neutral" : "good",
      });
    });
  }

  async function approveOne(o: CardOutreach) {
    const e = edits[o.id] ?? { draft: o.draft ?? "", note: o.draftNote ?? "" };
    if (e.draft !== (o.draft ?? "") || e.note !== (o.draftNote ?? "")) {
      await putJson("/api/network/outreach", { outreachId: o.id, draft: e.draft, draftNote: e.note || null });
    }
    return postJson<{ autoStarted?: boolean; runId?: number }>("/api/network/decide", { outreachId: o.id, decision: "approve" });
  }

  const approveDraft = (o: CardOutreach) =>
    run(`approve-${o.id}`, async () => {
      const j = await approveOne(o);
      toast({ title: `已批准给 ${o.personName} 的消息`, description: j.autoStarted ? "已排队发送任务,助手接手后发出。" : "助手会在下次任务里发出。", tone: "good" });
    });

  const approveAll = (c: ReferralCardData) =>
    run(`approve-all-${c.company}`, async () => {
      let started = false;
      for (const o of c.outreaches) {
        if (o.status !== "draft") continue;
        const j = await approveOne(o);
        started = started || !!j.autoStarted;
      }
      toast({ title: `已批准 ${c.company} 的全部草稿`, description: started ? "已排队发送任务,助手接手后发出。" : "助手会在下次任务里发出。", tone: "good" });
    });

  const rejectDraft = (o: CardOutreach) =>
    run(`reject-${o.id}`, async () => {
      await postJson("/api/network/decide", { outreachId: o.id, decision: "reject" });
      toast({ title: `已拒绝给 ${o.personName} 的草稿`, tone: "neutral" });
    });

  const unapproveDraft = (o: CardOutreach) =>
    run(`unapprove-${o.id}`, async () => {
      await postJson("/api/network/decide", { outreachId: o.id, decision: "unapprove" });
      setEdits((p) => {
        const n = { ...p };
        delete n[o.id];
        return n;
      });
    });

  const checkNow = () =>
    run("check", async () => {
      const j = await postJson<{ queued?: boolean; runId?: number }>("/api/referral/check", {});
      toast({
        title: j.queued ? "已排队检查回复" : "暂时不用检查",
        description: j.queued ? "助手接手后去 LinkedIn 看邀请和消息。" : "已有检查在排队或进行中,或没有需要检查的对话。",
        tone: j.queued ? "good" : "neutral",
      });
    });

  if (cards === null) return onlyAttention ? null : <SkeletonCard />;
  const visible = onlyAttention ? cards.filter(needsAttention) : cards;
  if (visible.length === 0) {
    if (onlyAttention) return null;
    return <EmptyState compact icon={<Handshake size={24} />} title="没有进行中的内推" description="在上方计划里给「找内推」填份数并开始投递,助手找到人后会在这里出现。" />;
  }

  return (
    <div className="col gap-3">
      {!onlyAttention ? (
        <div className="row">
          <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} loading={busy === "check"} onClick={checkNow}>
            现在检查回复
          </Button>
          <span className="muted xs">助手早 9 点、晚 6 点各自动查一次 LinkedIn 的邀请与消息,每次接任务前也会查。</span>
        </div>
      ) : null}

      {visible.map((c) => {
        const ready = c.jobs.some((j) => j.status === "referral_ready");
        const readyInfo = c.jobs.find((j) => j.referralInfo)?.referralInfo ?? null;
        const noContact = c.jobs.find((j) => j.noContactReason)?.noContactReason ?? null;
        const drafts = c.outreaches.filter((o) => o.status === "draft");
        const anyOut = c.outreaches.some((o) => o.status === "sent" || o.status === "replied" || o.status === "accepted");
        const referredOne = c.outreaches.find((o) => o.stage === "referred" || o.stage === "will_refer");
        const replied = referredOne ?? c.outreaches.find((o) => o.status === "replied" || o.status === "accepted" || o.status === "sent");
        const wonLink = referredOne?.stageLink ?? "";
        const wonIsUrl = /^https?:\/\//.test(wonLink);
        const counts = c.outreaches.reduce<Record<string, number>>((m, o) => ({ ...m, [o.status]: (m[o.status] ?? 0) + 1 }), {});
        const summary = Object.entries(counts)
          .map(([s, n]) => `${n} ${labelOf(OUTREACH_STATUS_LABEL, s, s)}`)
          .join(" · ");
        const busyHere = busy !== null && busy.endsWith(c.company);

        return (
          <Card key={c.company} tone={ready ? "good" : "default"} className="referral-card">
            <div className="row between">
              <div className="row">
                <span className="serif strong" style={{ fontSize: "var(--t-md)" }}>
                  {c.company}
                </span>
                {ready ? (
                  <Chip tone="good">有内推 · 待投</Chip>
                ) : c.outreaches.length > 0 ? (
                  <span className="muted small">
                    {c.outreaches.length} 人 · {summary}
                  </span>
                ) : noContact ? (
                  <Chip tone="danger" title={noContact}>
                    找不到人
                  </Chip>
                ) : (
                  <Chip tone="info">助手找人中…</Chip>
                )}
              </div>
              {c.daysWaiting != null ? (
                <span className={cx("small", c.overdue ? "text-danger strong" : "muted")}>
                  已等 {c.daysWaiting} 天{c.overdue ? " · 建议直接投" : ""}
                </span>
              ) : null}
            </div>
            {noContact && c.outreaches.length === 0 ? <p className="muted small mt-2">{noContact.replace(/^no contact found: /, "")}</p> : null}

            <ul className="referral-jobs">
              {c.jobs.map((j) => (
                <li key={j.jobId}>
                  {j.applyUrl ? (
                    <a href={j.applyUrl} target="_blank" rel="noreferrer">
                      {j.title}
                    </a>
                  ) : (
                    j.title
                  )}
                  <Chip outline>{j.direction ? directionLabel(j.direction) : "未分类"}</Chip>
                  <span className="muted mono xs">{j.score ?? "—"}</span>
                  {j.referralInfo ? (
                    <span className="text-good small">
                      内推:{j.referralPersonName ?? "—"} · {j.referralInfo.source}
                      {j.referralInfo.link ? " · 有链接" : ""}
                      {j.referralInfo.code ? ` · 码 ${j.referralInfo.code}` : ""}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>

            {c.outreaches.length > 0 ? (
              <div className="col gap-3 mt-2">
                {drafts.length > 1 ? (
                  <div className="row">
                    <Button size="sm" onClick={() => approveAll(c)} loading={busy === `approve-all-${c.company}`}>
                      全部批准({drafts.length} 条)
                    </Button>
                    <span className="muted xs">每人两版:私信版给已是好友的人,留言版随好友申请发;助手按对方能不能私信自动选。</span>
                  </div>
                ) : null}
                {c.outreaches.map((o) => (
                  <ReferralContact
                    key={o.id}
                    o={o}
                    edit={edits[o.id] ?? { draft: o.draft ?? "", note: o.draftNote ?? "" }}
                    onEdit={(patch) => setEdits((p) => ({ ...p, [o.id]: { ...(p[o.id] ?? { draft: o.draft ?? "", note: o.draftNote ?? "" }), ...patch } }))}
                    onApprove={() => approveDraft(o)}
                    onReject={() => rejectDraft(o)}
                    onUnapprove={() => unapproveDraft(o)}
                    busy={busy}
                  />
                ))}
              </div>
            ) : null}

            <div className="row mt-4">
              {ready ? (
                <Button variant="primary" onClick={() => decide(c, "won", { info: readyInfo })} loading={busyHere}>
                  开始投(重新入队)
                </Button>
              ) : (
                <>
                  <Button onClick={() => decide(c, "direct")} loading={busy === `direct-${c.company}`} disabled={busy !== null && !busyHere}>
                    直接投,不等内推
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      setWon({
                        company: c.company,
                        jobIds: c.jobs.map((j) => j.jobId),
                        personName: replied?.personName ?? "",
                        source: replied ? (replied.channel === "email" ? "email" : "linkedin") : "wechat",
                        link: wonIsUrl ? wonLink : "",
                        code: wonIsUrl ? "" : wonLink,
                        note: "",
                      })
                    }
                  >
                    有内推了…
                  </Button>
                  {anyOut ? (
                    <Button variant="ghost" onClick={() => decide(c, "retry")} loading={busy === `retry-${c.company}`} disabled={busy !== null && !busyHere}>
                      再撒网,换人
                    </Button>
                  ) : null}
                  <Button variant="ghost" className="text-danger" disabled={busy !== null} onClick={() => setArchiveFor(c)}>
                    放弃…
                  </Button>
                </>
              )}
            </div>
          </Card>
        );
      })}

      <ReferralWonDialog open={won !== null} initial={won} onClose={() => setWon(null)} onSaved={refresh} />
      <ConfirmDialog
        open={archiveFor !== null}
        onClose={() => setArchiveFor(null)}
        danger
        title={archiveFor ? `放弃 ${archiveFor.company} 的 ${archiveFor.jobs.length} 个岗位?` : "放弃"}
        description="岗位会归档,不再投递;可以在职位页的「全部入库」里找回。"
        confirmLabel="放弃"
        busy={archiveFor !== null && busy === `archive-${archiveFor.company}`}
        onConfirm={async () => {
          if (!archiveFor) return;
          const c = archiveFor;
          await decide(c, "archive");
          setArchiveFor(null);
        }}
      />
    </div>
  );
}
