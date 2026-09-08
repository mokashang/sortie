"use client";
import { ExternalLink, Mail, Sparkles } from "lucide-react";
import { MSG_CHANNEL_LABEL, OUTREACH_STATUS_LABEL, OUTREACH_STATUS_TONE, PLAYBOOK_LABEL, RELATION_LABEL, labelOf } from "@/app/lib/labels";
import { localShort } from "@/app/lib/time";
import { cx } from "@/app/lib/cx";
import { Button, Chip, EmptyState } from "@/app/components/ui";
import type { JobLite, OutreachRow, Person } from "./network-types";

export interface ContactDetailProps {
  person: Person | null;
  outreach: OutreachRow[];
  jobMap: Map<number, JobLite>;
  onDraft: () => void;
  onOutcome: (row: OutreachRow, outcome: "meeting" | "referral_won" | "no_response") => void;
  busyId: number | null;
}

const OUTCOME_LABEL: Record<string, string> = { meeting: "约到了", referral_won: "拿到内推", no_response: "无回应" };

export function ContactDetail({ person, outreach, jobMap, onDraft, onOutcome, busyId }: ContactDetailProps) {
  if (!person) {
    return <EmptyState compact title="选一位联系人" description="左侧点选后,这里显示资料和往来记录。" />;
  }
  const linkedJobs = Array.from(new Set(outreach.map((o) => o.jobId).filter((x): x is number => x != null)));

  return (
    <div className="contact-detail">
      <div className="row between">
        <div className="grow">
          <div className="row">
            <span className="serif strong" style={{ fontSize: "var(--t-lg)" }}>
              {person.name}
            </span>
            {person.relation ? <Chip outline>{labelOf(RELATION_LABEL, person.relation, person.relation)}</Chip> : null}
          </div>
          <div className="muted small mt-1">{[person.company, person.role_title].filter(Boolean).join(" · ") || "公司 / 职位未填"}</div>
          <div className="row mt-2 small">
            {person.linkedin_url ? (
              <a href={person.linkedin_url} target="_blank" rel="noreferrer" className="row row-nowrap gap-1">
                LinkedIn <ExternalLink size={11} aria-hidden />
              </a>
            ) : null}
            {person.email ? (
              <a href={`mailto:${person.email}`} className="row row-nowrap gap-1">
                <Mail size={11} aria-hidden /> {person.email}
              </a>
            ) : null}
          </div>
        </div>
        <Button size="sm" icon={<Sparkles size={13} />} onClick={onDraft}>
          AI 草稿…
        </Button>
      </div>

      {linkedJobs.length > 0 ? (
        <p className="muted small mt-3">
          关联岗位:
          {linkedJobs.map((jid) => (jobMap.has(jid) ? `${jobMap.get(jid)!.company} · ${jobMap.get(jid)!.title}` : `#${jid}`)).join(",")}
        </p>
      ) : null}

      <h4 className="mt-4">联系记录</h4>
      {outreach.length === 0 ? (
        <p className="muted small">还没有往来。点「AI 草稿」生成第一条消息。</p>
      ) : (
        <div className="col gap-3">
          {outreach.map((row) => (
            <div key={row.id} className="thread">
              <div className="row">
                <Chip outline>{labelOf(PLAYBOOK_LABEL, row.playbook, row.playbook)}</Chip>
                <Chip>{labelOf(MSG_CHANNEL_LABEL, row.channel, row.channel)}</Chip>
                <Chip tone={OUTREACH_STATUS_TONE[row.status] ?? "neutral"}>{labelOf(OUTREACH_STATUS_LABEL, row.status, row.status)}</Chip>
                {row.outcome ? <Chip tone="good">{OUTCOME_LABEL[row.outcome] ?? row.outcome}</Chip> : null}
                <span className="muted xs mono">{localShort(row.createdAt)}</span>
              </div>
              {row.threadLog.length === 0 ? (
                row.draft ? (
                  <div className="msg-quote is-secondary mt-2">{row.draft}</div>
                ) : (
                  <p className="muted xs mt-2">尚无消息记录。</p>
                )
              ) : (
                <div className="col gap-2 mt-2">
                  {row.threadLog.map((t, i) => (
                    <div key={i} className={cx("bubble", t.dir === "sent" ? "is-sent" : "is-received")}>
                      <div className="bubble-meta">
                        {t.dir === "sent" ? "你" : "对方"} · {localShort(t.at)}
                      </div>
                      <div className="bubble-text">{t.text}</div>
                    </div>
                  ))}
                </div>
              )}
              {row.status === "sent" || row.status === "replied" ? (
                <div className="row mt-2">
                  <span className="muted xs">结果:</span>
                  {(["meeting", "referral_won", "no_response"] as const).map((oc) => (
                    <Button key={oc} size="sm" variant="ghost" onClick={() => onOutcome(row, oc)} disabled={busyId === row.id}>
                      {OUTCOME_LABEL[oc]}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
