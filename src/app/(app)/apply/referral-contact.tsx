"use client";
import { ExternalLink } from "lucide-react";
import { OUTREACH_STATUS_TONE, REFERRAL_STAGE_TONE, labelOf } from "@/app/lib/labels";
import { localShort } from "@/app/lib/time";
import { cx } from "@/app/lib/cx";
import { Button, Chip, Field, Textarea } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";

export const NOTE_MAX = 200;

export interface CardOutreach {
  id: number;
  personId: number;
  personName: string;
  relation: string | null;
  linkedinUrl: string | null;
  personNotes: string | null;
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
  const m = useMessages();
  const noteLen = edit.note.trim().length;
  const stage = o.stage ?? "pending";
  const won = o.stage === "referred" || o.stage === "will_refer";

  return (
    <div className="referral-contact">
      <div className="row">
        <span className="strong">{o.personName}</span>
        {o.relation ? <span className="muted small">{labelOf(m.labels.relation, o.relation, o.relation)}</span> : null}
        {o.linkedinUrl ? (
          <a href={o.linkedinUrl} target="_blank" rel="noreferrer" className="small row row-nowrap gap-1">
            LinkedIn <ExternalLink size={11} aria-hidden />
          </a>
        ) : null}
        <Chip tone={OUTREACH_STATUS_TONE[o.status] ?? "neutral"}>{labelOf(m.labels.outreachStatus, o.status, o.status)}</Chip>
        {o.sentAt ? <span className="muted xs mono">{m.apply.contact.sentAt(localShort(o.sentAt))}</span> : null}
      </div>

      {CONVERSING.has(o.status) ? (
        <div className="mt-2 col gap-1">
          <div className="row">
            <Chip tone={REFERRAL_STAGE_TONE[stage] ?? "neutral"} outline>
              {labelOf(m.labels.referralStage, stage, stage)}
            </Chip>
            {o.lastCheckedAt ? <span className="muted xs">{m.apply.contact.lastChecked(localShort(o.lastCheckedAt))}</span> : null}
          </div>
          {o.stageSummary ? <div className="small">{o.stageSummary}</div> : null}
          {o.lastMessage && o.lastMessage.dir === "received" ? (
            <div className="msg-quote is-secondary">
              {m.apply.contact.theirMessage(localShort(o.lastMessage.at), o.lastMessage.text.slice(0, 200))}
              {o.lastMessage.text.length > 200 ? "…" : ""}
            </div>
          ) : null}
          {won ? (
            <div className="notice notice-good">
              <span>{m.apply.contact.wonNotice(o.stage === "referred", o.stageLink)}</span>
            </div>
          ) : o.stageAction ? (
            <div className="text-warn small">{m.apply.contact.suggestion(o.stageAction)}</div>
          ) : null}
        </div>
      ) : null}

      {o.status === "draft" ? (
        <div className="mt-3 col gap-3">
          {o.personNotes ? (
            <div className="msg-quote is-secondary small">
              {m.apply.contact.profileNotes(o.personNotes)}
              <div className="muted xs mt-1">{m.apply.contact.profileNotesHint}</div>
            </div>
          ) : (
            <div className="muted xs">{m.apply.contact.noProfileNotes}</div>
          )}
          <Field
            label={
              <>
                {m.apply.contact.fullLabel} <span className="muted mono xs">{m.apply.contact.chars(edit.draft.trim().length)}</span>
              </>
            }
            hint={m.apply.contact.fullHint}
            htmlFor={`draft-${o.id}`}
          >
            <Textarea id={`draft-${o.id}`} rows={5} value={edit.draft} onChange={(e) => onEdit({ draft: e.target.value })} autoGrow />
          </Field>
          <Field
            label={
              <>
                {m.apply.contact.noteLabel}{" "}
                <span className={cx("mono xs", noteLen > NOTE_MAX ? "text-danger" : "muted")}>
                  {noteLen}/{NOTE_MAX}
                </span>
              </>
            }
            hint={m.apply.contact.noteHint}
            error={noteLen > NOTE_MAX ? m.apply.contact.noteTooLong(noteLen - NOTE_MAX) : undefined}
            htmlFor={`note-${o.id}`}
          >
            <Textarea id={`note-${o.id}`} rows={3} value={edit.note} onChange={(e) => onEdit({ note: e.target.value })} autoGrow />
          </Field>
          <div className="row">
            <Button variant="primary" size="sm" onClick={onApprove} loading={busy === `approve-${o.id}`} disabled={noteLen > NOTE_MAX}>
              {m.apply.contact.approveSend}
            </Button>
            <Button variant="ghost" size="sm" onClick={onReject} loading={busy === `reject-${o.id}`}>
              {m.common.reject}
            </Button>
          </div>
        </div>
      ) : o.status === "pending_send" ? (
        <div className="mt-2 col gap-2">
          {o.draft ? <div className="msg-quote">{o.draft}</div> : null}
          {o.draftNote ? <div className="msg-quote is-secondary">{m.apply.contact.notePrefix(o.draftNote)}</div> : null}
          <div>
            <Button variant="ghost" size="sm" onClick={onUnapprove} loading={busy === `unapprove-${o.id}`}>
              {m.apply.contact.backToDraft}
            </Button>
          </div>
        </div>
      ) : o.draft && !CONVERSING.has(o.status) ? (
        <div className="mt-2 msg-quote is-secondary">{o.draft}</div>
      ) : null}
    </div>
  );
}
