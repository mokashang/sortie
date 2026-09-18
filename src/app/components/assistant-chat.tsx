"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Eraser, MessageCircleQuestionMark, Play, PlusCircle, SendHorizontal } from "lucide-react";
import type { ToolEvent } from "@/assistant/tools";
import { cx } from "@/app/lib/cx";
import { parseMarkdown, type Span } from "@/app/lib/chat-markdown";
import { Button, Drawer, EmptyState, IconButton, useToast } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
import { LogoMark } from "./shell/logo";

// The in-app 问助手 chat (spec 2026-09-18 §3): a drawer the user can open from the top bar, the
// phone 「更多」 sheet, ⌘K or ⌘/. The conversation lives in this provider (so it survives page
// navigation) and in sessionStorage (so it survives a reload, not a closed tab). Each send posts
// the recent turns to /api/assistant/chat and renders the answer as it streams in. Read-only by
// construction: nothing here calls any other API.

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "done" | "streaming" | "error";
  backend?: string;
  error?: string;
  // Tools the turn ran (an application started, a posting added) — shown as chips under the answer.
  actions?: ToolEvent[];
}

interface ChatContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  turns: ChatTurn[];
  busy: boolean;
  send: (text: string) => Promise<void>;
  retry: () => Promise<void>;
  clear: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const STORAGE_KEY = "sortie.chat";
const KEEP_TURNS = 40;
const SEND_TURNS = 12;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadTurns(): ChatTurn[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatTurn[];
    return Array.isArray(parsed) ? parsed.filter((t) => t.status === "done") : [];
  } catch {
    return [];
  }
}

function saveTurns(turns: ChatTurn[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(turns.filter((t) => t.status === "done").slice(-KEEP_TURNS)));
  } catch {
    // private window / storage blocked — the conversation just does not survive a reload
  }
}

// Reads the NDJSON answer stream: {"delta"} lines grow the bubble, {"done"} closes it, {"error"} marks it.
async function streamAnswer(
  history: { role: "user" | "assistant"; content: string }[],
  onDelta: (text: string) => void,
  onAction: (event: ToolEvent) => void,
  signal: AbortSignal
): Promise<{ text: string; backend?: string }> {
  const r = await fetch("/api/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: history }),
    signal,
  });
  if (!r.ok) {
    if (r.status === 401 && typeof window !== "undefined") window.location.assign("/login");
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `HTTP ${r.status}`);
  }
  if (!r.body) throw new Error("empty response");
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let text = "";
  let backend: string | undefined;
  let done = false;
  const handle = (line: string) => {
    if (!line.trim()) return;
    let ev: { delta?: string; done?: boolean; text?: string; backend?: string; error?: string; action?: ToolEvent };
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof ev.delta === "string") {
      text += ev.delta;
      onDelta(text);
    } else if (ev.action) {
      onAction(ev.action);
    } else if (ev.done) {
      if (typeof ev.text === "string" && ev.text) text = ev.text;
      backend = ev.backend;
      done = true;
    } else if (ev.error) {
      throw new Error(ev.error);
    }
  };
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buffered += decoder.decode(value, { stream: true });
    let nl = buffered.indexOf("\n");
    while (nl >= 0) {
      handle(buffered.slice(0, nl));
      buffered = buffered.slice(nl + 1);
      nl = buffered.indexOf("\n");
    }
  }
  if (buffered.trim()) handle(buffered);
  if (!done && !text) throw new Error("no answer");
  return { text, backend };
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setTurns(loadTurns()), []);
  useEffect(() => saveTurns(turns), [turns]);

  const run = useCallback(async (base: ChatTurn[]) => {
    const history = base
      .filter((t) => t.status === "done" || t.role === "user")
      .slice(-SEND_TURNS)
      .map((t) => ({ role: t.role, content: t.content }));
    const id = newId();
    setTurns([...base, { id, role: "assistant", content: "", status: "streaming" }]);
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await streamAnswer(
        history,
        (text) => setTurns((cur) => cur.map((t) => (t.id === id ? { ...t, content: text } : t))),
        (event) => setTurns((cur) => cur.map((t) => (t.id === id ? { ...t, actions: [...(t.actions ?? []), event] } : t))),
        ctl.signal
      );
      setTurns((cur) => cur.map((t) => (t.id === id ? { ...t, content: r.text, status: "done", backend: r.backend } : t)));
    } catch (e) {
      if (ctl.signal.aborted) {
        setTurns((cur) => cur.filter((t) => t.id !== id));
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        setTurns((cur) => cur.map((t) => (t.id === id ? { ...t, status: "error", error: msg } : t)));
      }
    } finally {
      if (abort.current === ctl) abort.current = null;
      setBusy(false);
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      const base = [...turns.filter((t) => t.status !== "error"), { id: newId(), role: "user" as const, content, status: "done" as const }];
      await run(base);
    },
    [busy, turns, run]
  );

  const retry = useCallback(async () => {
    if (busy) return;
    const base = turns.filter((t) => t.status !== "error");
    if (base.length === 0 || base[base.length - 1].role !== "user") return;
    await run(base);
  }, [busy, turns, run]);

  const clear = useCallback(() => {
    abort.current?.abort();
    setTurns([]);
  }, []);

  const value = useMemo<ChatContextValue>(
    () => ({ open, setOpen, toggle: () => setOpen((o) => !o), turns, busy, send, retry, clear }),
    [open, turns, busy, send, retry, clear]
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const v = useContext(ChatContext);
  if (!v) throw new Error("useChat outside ChatProvider");
  return v;
}

function useShortcutLabel(): string {
  const [label, setLabel] = useState("Ctrl /");
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform)) setLabel("⌘/");
  }, []);
  return label;
}

// Top-bar entry: icon plus the word on desktop, icon only on phones.
export function ChatButton() {
  const m = useMessages();
  const { open, toggle } = useChat();
  const shortcut = useShortcutLabel();
  return (
    <button
      type="button"
      className={cx("btn btn-ghost btn-sm topbar-icon topbar-chat", open && "is-active")}
      onClick={toggle}
      aria-label={m.chat.openAria}
      title={m.chat.openTitle(shortcut)}
      aria-pressed={open}
    >
      <MessageCircleQuestionMark size={16} aria-hidden />
      <span className="topbar-chat-word hide-mobile">{m.chat.open}</span>
    </button>
  );
}

function Inline({ spans, onNavigate }: { spans: Span[]; onNavigate: () => void }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === "strong") return <strong key={i}>{s.text}</strong>;
        if (s.kind === "code") return <code key={i}>{s.text}</code>;
        if (s.kind === "link") {
          return s.internal ? (
            <Link key={i} href={s.href} onClick={onNavigate}>
              {s.text}
            </Link>
          ) : (
            <a key={i} href={s.href} target="_blank" rel="noreferrer noopener">
              {s.text}
            </a>
          );
        }
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

export function ChatMarkdown({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className="chat-md">
      {blocks.map((b, i) => {
        if (b.kind === "p") {
          return (
            <p key={i}>
              <Inline spans={b.spans} onNavigate={onNavigate} />
            </p>
          );
        }
        const Tag = b.kind === "ul" ? "ul" : "ol";
        return (
          <Tag key={i}>
            {b.items.map((item, j) => (
              <li key={j}>
                <Inline spans={item} onNavigate={onNavigate} />
              </li>
            ))}
          </Tag>
        );
      })}
    </div>
  );
}

export function ChatDrawer() {
  const m = useMessages();
  const { open, setOpen, turns, busy, send, retry, clear } = useChat();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [open, turns]);

  async function submit() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    await send(text);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  }

  const backendName = (key: string | undefined) => (key ? (m.chat.backends as Record<string, string>)[key] ?? key : "");

  return (
    <Drawer
      open={open}
      onClose={close}
      title={
        <span className="row gap-2 row-nowrap">
          <LogoMark size={18} />
          {m.chat.title}
        </span>
      }
      subtitle={m.chat.subtitle}
      width={520}
      footer={
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            value={draft}
            placeholder={m.chat.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            aria-label={m.chat.title}
          />
          <div className="chat-composer-actions">
            {turns.length > 0 ? (
              <IconButton
                label={m.chat.clear}
                icon={<Eraser size={15} />}
                onClick={() => {
                  clear();
                  toast({ title: m.chat.cleared, tone: "neutral" });
                }}
              />
            ) : null}
            <Button type="submit" variant="primary" size="sm" icon={<SendHorizontal size={14} />} loading={busy} disabled={!draft.trim() || busy}>
              {busy ? m.chat.sending : m.chat.send}
            </Button>
          </div>
        </form>
      }
    >
      {turns.length === 0 ? (
        <div className="chat-empty">
          <EmptyState
            compact
            icon={<MessageCircleQuestionMark size={28} />}
            title={m.chat.emptyTitle}
            description={m.chat.emptyDescription}
            action={
              <div className="chat-examples">
                {m.chat.examples.map((q) => (
                  <button key={q} type="button" className="chip chip-btn" onClick={() => void send(q)} disabled={busy}>
                    {q}
                  </button>
                ))}
              </div>
            }
          />
        </div>
      ) : (
        <ol className="chat-list" aria-live="polite">
          {turns.map((t) => (
            <li key={t.id} className={cx("chat-turn", t.role === "user" ? "is-user" : "is-assistant", t.status === "error" && "is-error")}>
              <div className="chat-who">{t.role === "user" ? m.chat.you : m.chat.assistant}</div>
              <div className="chat-bubble">
                {t.role === "user" ? (
                  <p>{t.content}</p>
                ) : t.status === "error" ? (
                  <>
                    <p>
                      {m.chat.failed}
                      {t.error ? ` · ${t.error}` : ""}
                    </p>
                    <Button size="sm" onClick={() => void retry()} disabled={busy}>
                      {m.chat.retry}
                    </Button>
                  </>
                ) : t.content ? (
                  <ChatMarkdown text={t.content} onNavigate={close} />
                ) : (
                  <p className="muted chat-thinking">{m.chat.thinking}</p>
                )}
                {t.role === "assistant" && t.actions?.some((a) => a.ok && (a.tool === "apply" || a.tool === "add_job")) ? (
                  <div className="chat-actions">
                    {t.actions
                      .filter((a) => a.ok && (a.tool === "apply" || a.tool === "add_job"))
                      .map((a, i) =>
                        a.tool === "apply" && a.runId ? (
                          <Link key={i} href="/apply" className="chip chip-accent" onClick={close}>
                            <Play size={12} aria-hidden /> {m.chat.actionApply(a.runId)} · {a.company}
                          </Link>
                        ) : (
                          <span key={i} className="chip">
                            <PlusCircle size={12} aria-hidden /> {m.chat.actionAdded} · {a.company} {a.title}
                          </span>
                        )
                      )}
                  </div>
                ) : null}
                {t.role === "assistant" && t.status === "done" && t.backend ? <div className="chat-meta">{m.chat.poweredBy(backendName(t.backend))}</div> : null}
              </div>
            </li>
          ))}
          <div ref={bottomRef} />
        </ol>
      )}
    </Drawer>
  );
}
