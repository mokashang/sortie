"use client";
import { ExternalLink, Mail, Sparkles } from "lucide-react";
import { OUTREACH_STATUS_TONE, labelOf } from "@/app/lib/labels";
import { localShort } from "@/app/lib/time";
import { cx } from "@/app/lib/cx";
import { Button, Chip, EmptyState } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import type { JobLite, OutreachRow, Person } from "./network-types";

export interface ContactDetailProps {
  person: Person | null;
  outreach: OutreachRow[];
  jobMap: Map<number, JobLite>;
  onDraft: () => void;
  onOutcome: (row: OutreachRow, outcome: "meeting" | "referral_won" | "no_response") => void;
  busyId: number | null;
}

export function ContactDetail({ person, outreach, jobMap, onDraft, onOutcome, busyId }: ContactDetailProps) {
  const m = useMessages();
  if (!person) {
    return <EmptyState compact title={m.network.detail.pickTitle} description={m.network.detail.pickDescription} />;
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
            {person.relation ? <Chip outline>{labelOf(m.labels.relation, person.relation, person.relation)}</Chip> : null}
          </div>
          <div className="muted small mt-1">{[person.company, person.role_title].filter(Boolean).join(" · ") || m.network.detail.noCompanyRole}</div>
          {person.notes ? <div className="small mt-1">{m.network.detail.assistantNotes(person.notes)}</div> : null}
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
          {m.network.detail.aiDraft}
        </Button>
      </div>

      {linkedJobs.length > 0 ? (
        <p className="muted small mt-3">
          {m.network.detail.linkedJobs(linkedJobs.map((jid) => (jobMap.has(jid) ? `${jobMap.get(jid)!.company} · ${jobMap.get(jid)!.title}` : `#${jid}`)))}
        </p>
      ) : null}

      <h4 className="mt-4">{m.network.detail.history}</h4>
      {outreach.length === 0 ? (
        <p className="muted small">{m.network.detail.noHistory}</p>
      ) : (
        <div className="col gap-3">
          {outreach.map((row) => (
            <div key={row.id} className="thread">
              <div className="row">
                <Chip outline>{labelOf(m.labels.playbook, row.playbook, row.playbook)}</Chip>
                <Chip>{labelOf(m.labels.msgChannel, row.channel, row.channel)}</Chip>
                <Chip tone={OUTREACH_STATUS_TONE[row.status] ?? "neutral"}>{labelOf(m.labels.outreachStatus, row.status, row.status)}</Chip>
                {row.outcome ? <Chip tone="good">{labelOf(m.network.detail.outcomes, row.outcome, row.outcome)}</Chip> : null}
                <span className="muted xs mono">{localShort(row.createdAt)}</span>
              </div>
              {row.threadLog.length === 0 ? (
                row.draft ? (
                  <div className="msg-quote is-secondary mt-2">{row.draft}</div>
                ) : (
                  <p className="muted xs mt-2">{m.network.detail.noMessages}</p>
                )
              ) : (
                <div className="col gap-2 mt-2">
                  {row.threadLog.map((t, i) => (
                    <div key={i} className={cx("bubble", t.dir === "sent" ? "is-sent" : "is-received")}>
                      <div className="bubble-meta">
                        {t.dir === "sent" ? m.network.detail.you : m.network.detail.them} · {localShort(t.at)}
                      </div>
                      <div className="bubble-text">{t.text}</div>
                    </div>
                  ))}
                </div>
              )}
              {row.status === "sent" || row.status === "replied" ? (
                <div className="row mt-2">
                  <span className="muted xs">{m.network.detail.outcome}</span>
                  {(["meeting", "referral_won", "no_response"] as const).map((oc) => (
                    <Button key={oc} size="sm" variant="ghost" onClick={() => onOutcome(row, oc)} disabled={busyId === row.id}>
                      {m.network.detail.outcomes[oc]}
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
