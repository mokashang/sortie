"use client";
import { ExternalLink } from "lucide-react";
import { OUTREACH_STATUS_LABEL, OUTREACH_STATUS_TONE, REFERRAL_STAGE_LABEL, REFERRAL_STAGE_TONE, RELATION_LABEL, labelOf } from "@/app/lib/labels";
import { localShort } from "@/app/lib/time";
import { cx } from "@/app/lib/cx";
import { Button, Chip, Field, Textarea } from "@/app/components/ui";

export const NOTE_MAX = 200;

export interface CardOutreach {
  id: number;
  personId: number;
  personName: string;
  relation: string | null;
  linkedinUrl: string | null;
  channel: string;
  status: string;
  draft: string | null;
  draftNote: string | null;
  sentAt: string | null;
  stage: string | null;
  stageSummary: string | null;
  stageAction: string | null;
  stageLink: string | null;
  lastCheckedAt: string | null;
  lastMessage: { dir: "sent" | "received"; at: string; text: string } | null;
}

export interface Edited {
  draft: string;
  note: string;
}

export interface ReferralContactProps {
  o: CardOutreach;
  edit: Edited;
  onEdit: (patch: Partial<Edited>) => void;
  onApprove: () => void;
  onReject: () => void;
  onUnapprove: () => void;
  busy: string | null;
}

const CONVERSING = new Set(["sent", "accepted", "replied"]);

// One contact inside a referral company card: who they are, where the conversation stands, and
// (while still a draft) the two editable message versions with approve/reject.
export function ReferralContact({ o, edit, onEdit, onApprove, onReject, onUnapprove, busy }: ReferralContactProps) {
  const noteLen = edit.note.trim().length;
  const stage = o.stage ?? "pending";
  const won = o.stage === "referred" || o.stage === "will_refer";

  return (
    <div className="referral-contact">
      <div className="row">
        <span className="strong">{o.personName}</span>
        {o.relation ? <span className="muted small">{labelOf(RELATION_LABEL, o.relation, o.relation)}</span> : null}
        {o.linkedinUrl ? (
          <a href={o.linkedinUrl} target="_blank" rel="noreferrer" className="small row row-nowrap gap-1">
            LinkedIn <ExternalLink size={11} aria-hidden />
          </a>
        ) : null}
        <Chip tone={OUTREACH_STATUS_TONE[o.status] ?? "neutral"}>{labelOf(OUTREACH_STATUS_LABEL, o.status, o.status)}</Chip>
        {o.sentAt ? <span className="muted xs mono">发于 {localShort(o.sentAt)}</span> : null}
      </div>

      {CONVERSING.has(o.status) ? (
        <div className="mt-2 col gap-1">
          <div className="row">
            <Chip tone={REFERRAL_STAGE_TONE[stage] ?? "neutral"} outline>
              {labelOf(REFERRAL_STAGE_LABEL, stage, stage)}
            </Chip>
            {o.lastCheckedAt ? <span className="muted xs">上次检查 {localShort(o.lastCheckedAt)}</span> : null}
          </div>
          {o.stageSummary ? <div className="small">{o.stageSummary}</div> : null}
          {o.lastMessage && o.lastMessage.dir === "received" ? (
            <div className="msg-quote is-secondary">
              对方 {localShort(o.lastMessage.at)}:{o.lastMessage.text.slice(0, 200)}
              {o.lastMessage.text.length > 200 ? "…" : ""}
            </div>
          ) : null}
          {won ? (
            <div className="notice notice-good">
              <span>
                {o.stage === "referred" ? "对方说已经内推了" : "对方答应内推"}
                {o.stageLink ? ` · 链接/码:${o.stageLink}` : ""}。请点下方「有内推了」确认。
              </span>
            </div>
          ) : o.stageAction ? (
            <div className="text-warn small">建议:{o.stageAction}</div>
          ) : null}
        </div>
      ) : null}

      {o.status === "draft" ? (
        <div className="mt-3 col gap-3">
          <Field
            label={
              <>
                完整版(私信) <span className="muted mono xs">{edit.draft.trim().length} 字符</span>
              </>
            }
            hint="对方已是好友时发这一版"
            htmlFor={`draft-${o.id}`}
          >
            <Textarea id={`draft-${o.id}`} rows={5} value={edit.draft} onChange={(e) => onEdit({ draft: e.target.value })} autoGrow />
          </Field>
          <Field
            label={
              <>
                留言版(好友申请){" "}
                <span className={cx("mono xs", noteLen > NOTE_MAX ? "text-danger" : "muted")}>
                  {noteLen}/{NOTE_MAX}
                </span>
              </>
            }
            hint="走 Connect 时附的留言;免费账号上限 200 字符"
            error={noteLen > NOTE_MAX ? `超出 ${noteLen - NOTE_MAX} 字符,请精简` : undefined}
            htmlFor={`note-${o.id}`}
          >
            <Textarea id={`note-${o.id}`} rows={3} value={edit.note} onChange={(e) => onEdit({ note: e.target.value })} autoGrow />
          </Field>
          <div className="row">
            <Button variant="primary" size="sm" onClick={onApprove} loading={busy === `approve-${o.id}`} disabled={noteLen > NOTE_MAX}>
              批准发送
            </Button>
            <Button variant="ghost" size="sm" onClick={onReject} loading={busy === `reject-${o.id}`}>
              拒绝
            </Button>
          </div>
        </div>
      ) : o.status === "pending_send" ? (
        <div className="mt-2 col gap-2">
          {o.draft ? <div className="msg-quote">{o.draft}</div> : null}
          {o.draftNote ? <div className="msg-quote is-secondary">留言版:{o.draftNote}</div> : null}
          <div>
            <Button variant="ghost" size="sm" onClick={onUnapprove} loading={busy === `unapprove-${o.id}`}>
              退回草稿,改文字
            </Button>
          </div>
        </div>
      ) : o.draft && !CONVERSING.has(o.status) ? (
        <div className="mt-2 msg-quote is-secondary">{o.draft}</div>
      ) : null}
    </div>
  );
}
