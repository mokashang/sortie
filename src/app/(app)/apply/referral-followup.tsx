"use client";
import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { localShort } from "@/app/lib/time";
import { Button, Chip, Field, Textarea } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";

export interface CardFollowup {
  id: number;
  kind: "intro" | "reply" | "nudge";
  status: "needs_user" | "draft" | "pending_send";
  text: string | null;
  attachResume: boolean;
  question: string | null;
  userAnswer: string | null;
  reason: string | null;
}

export interface ThreadEntry {
  dir: "sent" | "received";
  at: string;
  text: string;
}

// The whole conversation with one contact, collapsed by default.
export function ReferralThread({ thread, personName }: { thread: ThreadEntry[]; personName: string }) {
  const m = useMessages();
  if (thread.length === 0) return null;
  return (
    <details className="referral-thread">
      <summary className="small muted">{m.apply.contact.conversation(thread.length)}</summary>
      <div className="col gap-2 mt-2">
        {thread.map((t, i) => (
          <div key={i} className={t.dir === "sent" ? "msg-quote is-secondary" : "msg-quote"}>
            <div className="muted xs mono thread-meta">
              {t.dir === "sent" ? m.apply.contact.you : personName} · {localShort(t.at)}
            </div>
            {t.text}
          </div>
        ))}
      </div>
    </details>
  );
}

export interface ReferralFollowupProps {
  f: CardFollowup;
  busy: string | null;
  onApprove: (text: string) => void;
  onReject: () => void;
  onUnapprove: () => void;
  onAnswer: (answer: string) => void;
}

// The next message in a referral conversation (src/network/followup.ts): a question only the user
// can answer, a draft to approve, or an approved one waiting for the assistant to send it.
export function ReferralFollowup({ f, busy, onApprove, onReject, onUnapprove, onAnswer }: ReferralFollowupProps) {
  const m = useMessages();
  const t = m.apply.contact.followup;
  const [text, setText] = useState(f.text ?? "");
  const [answer, setAnswer] = useState("");
  // A new draft (the conversation moved, or the answer was drafted) replaces any local edit.
  useEffect(() => {
    setText(f.text ?? "");
  }, [f.id, f.text]);

  return (
    <div className="referral-followup col gap-2">
      <div className="row">
        <Chip tone="info" outline>
          {t.kind[f.kind]}
        </Chip>
        <Chip tone={f.status === "pending_send" ? "good" : "warn"}>{t.status[f.status]}</Chip>
        {f.attachResume ? (
          <span className="muted xs row row-nowrap gap-1">
            <Paperclip size={11} aria-hidden /> {t.attachResume}
          </span>
        ) : null}
      </div>
      {f.reason ? <div className="muted small">{f.reason}</div> : null}

      {f.status === "needs_user" ? (
        <>
          {f.question ? <div className="notice notice-warn">{f.question}</div> : null}
          <Field label={t.answerLabel} htmlFor={`fu-answer-${f.id}`}>
            <Textarea id={`fu-answer-${f.id}`} rows={2} value={answer} placeholder={t.answerPlaceholder} onChange={(e) => setAnswer(e.target.value)} autoGrow />
          </Field>
          <div className="row">
            <Button variant="primary" size="sm" disabled={!answer.trim()} loading={busy === `fu-answer-${f.id}`} onClick={() => onAnswer(answer.trim())}>
              {t.draftFromAnswer}
            </Button>
            <Button variant="ghost" size="sm" loading={busy === `fu-reject-${f.id}`} onClick={onReject}>
              {t.dontReply}
            </Button>
          </div>
        </>
      ) : f.status === "draft" ? (
        <>
          <Field
            label={
              <>
                {t.textLabel} <span className="muted mono xs">{m.apply.contact.chars(text.trim().length)}</span>
              </>
            }
            htmlFor={`fu-text-${f.id}`}
          >
            <Textarea id={`fu-text-${f.id}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} autoGrow />
          </Field>
          <div className="row">
            <Button variant="primary" size="sm" disabled={!text.trim()} loading={busy === `fu-approve-${f.id}`} onClick={() => onApprove(text.trim())}>
              {m.apply.contact.approveSend}
            </Button>
            <Button variant="ghost" size="sm" loading={busy === `fu-reject-${f.id}`} onClick={onReject}>
              {t.dontSend}
            </Button>
          </div>
        </>
      ) : (
        <>
          {f.text ? <div className="msg-quote">{f.text}</div> : null}
          <div>
            <Button variant="ghost" size="sm" loading={busy === `fu-unapprove-${f.id}`} onClick={onUnapprove}>
              {m.apply.contact.backToDraft}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
