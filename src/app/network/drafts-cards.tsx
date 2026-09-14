"use client";
import { Mail } from "lucide-react";
import { labelOf } from "@/app/lib/labels";
import { Button, Card, Chip, EmptyState, LinkButton, Section, Textarea } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { mailtoFor, type OutreachRow, type SendableRow } from "./network-types";

export interface DraftsCardsProps {
  drafts: OutreachRow[];
  sendables: SendableRow[];
  edited: Record<number, string>;
  onEdit: (id: number, text: string) => void;
  onApprove: (row: OutreachRow) => void;
  onReject: (row: OutreachRow) => void;
  onMarkSent: (row: SendableRow) => void;
  busyId: number | null;
}

// 草稿待批 + 已批准待发 for coffee-chat / exploratory outreach (not job-linked).
export function DraftsCards({ drafts, sendables, edited, onEdit, onApprove, onReject, onMarkSent, busyId }: DraftsCardsProps) {
  const m = useMessages();
  return (
    <>
      <Section title={m.network.drafts.title} count={drafts.length} description={m.network.drafts.description}>
        {drafts.length === 0 ? (
          <EmptyState compact title={m.network.drafts.empty} description={m.network.drafts.emptyDescription} />
        ) : (
          <div className="col gap-3">
            {drafts.map((row) => (
              <Card key={row.id}>
                <div className="row">
                  <span className="muted small">{m.network.drafts.recipient}</span>
                  <span className="serif strong">{row.personName}</span>
                  {row.personCompany ? <span className="muted small">{row.personCompany}</span> : null}
                  <Chip outline>{labelOf(m.labels.playbook, row.playbook, row.playbook)}</Chip>
                  <Chip>{labelOf(m.labels.msgChannel, row.channel, row.channel)}</Chip>
                </div>
                <Textarea
                  className="mt-3"
                  rows={6}
                  value={edited[row.id] ?? row.draft ?? ""}
                  onChange={(e) => onEdit(row.id, e.target.value)}
                  autoGrow
                  aria-label={m.network.drafts.draftFor(row.personName)}
                />
                <div className="row mt-3">
                  <Button variant="primary" size="sm" onClick={() => onApprove(row)} loading={busyId === row.id}>
                    {m.network.drafts.approve}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onReject(row)} disabled={busyId === row.id}>
                    {m.common.reject}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {sendables.length > 0 ? (
        <Section title={m.network.drafts.sendablesTitle} count={sendables.length} description={m.network.drafts.sendablesDescription}>
          <div className="col gap-3">
            {sendables.map((row) => {
              const mailto = mailtoFor(row);
              return (
                <Card key={row.id}>
                  <div className="row">
                    <span className="muted small">{m.network.drafts.recipient}</span>
                    <span className="serif strong">{row.personName}</span>
                    <Chip outline>{labelOf(m.labels.playbook, row.playbook, row.playbook)}</Chip>
                    <Chip>{labelOf(m.labels.msgChannel, row.channel, row.channel)}</Chip>
                  </div>
                  <div className="msg-quote mt-3">{row.draft}</div>
                  <div className="row mt-3">
                    {row.channel === "linkedin" ? (
                      <Chip tone="info" size="md">
                        {m.network.drafts.waitingForAssistant}
                      </Chip>
                    ) : (
                      <>
                        {mailto ? (
                          <LinkButton href={mailto} size="sm" icon={<Mail size={13} />}>
                            {m.network.drafts.openMail}
                          </LinkButton>
                        ) : (
                          <span className="muted small">{m.network.drafts.noEmail}</span>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => onMarkSent(row)} loading={busyId === row.id}>
                          {m.network.drafts.markSent}
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>
      ) : null}
    </>
  );
}
