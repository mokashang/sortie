"use client";
import { Mail } from "lucide-react";
import { MSG_CHANNEL_LABEL, PLAYBOOK_LABEL, labelOf } from "@/app/lib/labels";
import { Button, Card, Chip, EmptyState, LinkButton, Section, Textarea } from "@/app/components/ui";
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
  return (
    <>
      <Section title="待批准草稿" count={drafts.length} description="助手只发送你批准过的原文;可以先改再批准。">
        {drafts.length === 0 ? (
          <EmptyState compact title="没有待批准的草稿" description="选一位联系人点「AI 草稿」,或让助手去找人。" />
        ) : (
          <div className="col gap-3">
            {drafts.map((row) => (
              <Card key={row.id}>
                <div className="row">
                  <span className="muted small">收件人</span>
                  <span className="serif strong">{row.personName}</span>
                  {row.personCompany ? <span className="muted small">{row.personCompany}</span> : null}
                  <Chip outline>{labelOf(PLAYBOOK_LABEL, row.playbook, row.playbook)}</Chip>
                  <Chip>{labelOf(MSG_CHANNEL_LABEL, row.channel, row.channel)}</Chip>
                </div>
                <Textarea className="mt-3" rows={6} value={edited[row.id] ?? row.draft ?? ""} onChange={(e) => onEdit(row.id, e.target.value)} autoGrow aria-label={`给 ${row.personName} 的草稿`} />
                <div className="row mt-3">
                  <Button variant="primary" size="sm" onClick={() => onApprove(row)} loading={busyId === row.id}>
                    批准发送
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => onReject(row)} disabled={busyId === row.id}>
                    拒绝
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {sendables.length > 0 ? (
        <Section title="已批准,待发出" count={sendables.length} description="LinkedIn 消息由助手发出;邮件用你自己的邮件客户端发,发完点「标记已发」。">
          <div className="col gap-3">
            {sendables.map((row) => {
              const mailto = mailtoFor(row);
              return (
                <Card key={row.id}>
                  <div className="row">
                    <span className="muted small">收件人</span>
                    <span className="serif strong">{row.personName}</span>
                    <Chip outline>{labelOf(PLAYBOOK_LABEL, row.playbook, row.playbook)}</Chip>
                    <Chip>{labelOf(MSG_CHANNEL_LABEL, row.channel, row.channel)}</Chip>
                  </div>
                  <div className="msg-quote mt-3">{row.draft}</div>
                  <div className="row mt-3">
                    {row.channel === "linkedin" ? (
                      <Chip tone="info" size="md">
                        等助手发送
                      </Chip>
                    ) : (
                      <>
                        {mailto ? (
                          <LinkButton href={mailto} size="sm" icon={<Mail size={13} />}>
                            打开邮件
                          </LinkButton>
                        ) : (
                          <span className="muted small">联系人没有邮箱</span>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => onMarkSent(row)} loading={busyId === row.id}>
                          标记已发
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
