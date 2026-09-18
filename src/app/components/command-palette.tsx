"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Briefcase, CornerDownLeft, Languages, MessageCircleQuestionMark, Monitor, Moon, Play, Search, Sun } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson } from "@/app/lib/api";
import { ALL_JOBS_DIRECTION } from "@/app/lib/queue-const";
import { getTheme, setTheme, type Theme } from "@/app/lib/settings";
import { cx } from "@/app/lib/cx";
import { useMessages } from "@/i18n/client";
import { LANG_NAME, otherLang } from "@/i18n/lang";
import { useLangToggle } from "./shell/use-lang-toggle";
import { NAV, SETTINGS_NAV } from "./shell/nav";

interface JobHit {
  id: number;
  company: string;
  title: string;
  direction: string | null;
  score: number | null;
  in_queue?: number;
}

interface Item {
  key: string;
  group: string;
  label: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

const THEME_NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

// ⌘K: pages, a few actions, and a live search over every job in the library. Navigation only —
// nothing here submits, sends or starts a task without the page's own confirmation.
export function CommandPalette({ open, onClose, onAskAssistant }: { open: boolean; onClose: () => void; onAskAssistant?: () => void }) {
  const m = useMessages();
  const router = useRouter();
  const langToggle = useLangToggle();
  const [q, setQ] = useState("");
  const [jobs, setJobs] = useState<JobHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setJobs([]);
    setActive(0);
    document.body.classList.add("no-scroll");
    const t = setTimeout(() => inputRef.current?.focus(), 10);
    return () => {
      clearTimeout(t);
      document.body.classList.remove("no-scroll");
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setJobs([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      const sp = new URLSearchParams({ direction: ALL_JOBS_DIRECTION, page: "1", pageSize: "6", sort: "score", q: term });
      getJson<{ rows: JobHit[] }>(`/api/queue?${sp.toString()}`)
        .then((j) => {
          if (mine === seq.current) setJobs(j.rows ?? []);
        })
        .catch(() => {});
    }, 160);
    return () => clearTimeout(t);
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const go = (href: string) => () => {
      onClose();
      router.push(href);
    };
    const pages: Item[] = [...NAV, SETTINGS_NAV]
      .filter((n) => !term || m.nav[n.key].toLowerCase().includes(term) || n.href.includes(term))
      .map((n) => {
        const Icon = n.icon;
        return { key: `page:${n.href}`, group: m.palette.groups.pages, label: m.nav[n.key], hint: m.common.open, icon: <Icon size={16} />, run: go(n.href) };
      });
    const theme = typeof window === "undefined" ? "system" : getTheme();
    const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
    const actions: Item[] = [
      { key: "act:apply", group: m.palette.groups.actions, label: m.palette.startApply, hint: m.palette.startApplyHint, icon: <Play size={16} />, run: go("/apply#plan") },
      { key: "act:queue", group: m.palette.groups.actions, label: m.palette.queueTop, hint: m.palette.queueTopHint, icon: <Briefcase size={16} />, run: go("/queue") },
      ...(onAskAssistant
        ? [
            {
              key: "act:chat",
              group: m.palette.groups.actions,
              label: m.palette.askAssistant,
              hint: m.palette.askAssistantHint,
              icon: <MessageCircleQuestionMark size={16} />,
              run: () => {
                onClose();
                onAskAssistant();
              },
            },
          ]
        : []),
      {
        key: "act:theme",
        group: m.palette.groups.actions,
        label: m.palette.switchTheme(m.shell.themes[theme]),
        hint: m.shell.themes[THEME_NEXT[theme]],
        icon: <ThemeIcon size={16} />,
        run: () => {
          setTheme(THEME_NEXT[theme]);
          onClose();
        },
      },
      {
        key: "act:lang",
        group: m.palette.groups.actions,
        label: m.palette.switchLanguage(langToggle.name),
        hint: LANG_NAME[otherLang(langToggle.lang)],
        icon: <Languages size={16} />,
        run: () => {
          langToggle.toggle();
          onClose();
        },
      },
    ].filter((a) => !term || String(a.label).toLowerCase().includes(term) || m.palette.actionKeywords.includes(term));
    const hits: Item[] = jobs.map((j) => {
      const dir = j.in_queue === 1 && j.direction ? j.direction : ALL_JOBS_DIRECTION;
      const sp = new URLSearchParams({ direction: dir, q: j.company });
      return {
        key: `job:${j.id}`,
        group: m.palette.groups.jobs,
        label: (
          <>
            <span className="strong">{j.company}</span>
            <span className="muted">{j.title}</span>
          </>
        ),
        hint: j.score != null ? m.palette.scoreHint(j.score, j.direction ? directionLabel(j.direction) : null) : m.palette.unscored,
        icon: <Briefcase size={16} />,
        run: go(`/queue?${sp.toString()}`),
      };
    });
    return term.length >= 2 ? [...hits, ...pages, ...actions] : [...pages, ...actions];
  }, [q, jobs, router, onClose, onAskAssistant, m, langToggle]);

  useEffect(() => setActive(0), [items.length, q]);

  useEffect(() => {
    const el = listRef.current?.querySelectorAll<HTMLElement>(".cmdk-item")[active];
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  let lastGroup = "";
  return (
    <>
      <div className="cmdk-backdrop" onClick={onClose} />
      <div className="cmdk-wrap">
        <div className="cmdk" role="dialog" aria-modal="true" aria-label={m.shell.searchLabel} onKeyDown={onKeyDown}>
          <div className="cmdk-input-row">
            <Search size={16} aria-hidden />
            <input
              ref={inputRef}
              className="cmdk-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={m.palette.placeholder}
              aria-label={m.common.search}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="cmdk-list" ref={listRef} role="listbox">
            {items.length === 0 ? (
              <div className="cmdk-empty">{q.trim().length >= 2 ? m.palette.noMatch : m.palette.typeToStart}</div>
            ) : (
              items.map((it, i) => {
                const head = it.group !== lastGroup ? <div className="cmdk-group">{it.group}</div> : null;
                lastGroup = it.group;
                return (
                  <div key={it.key}>
                    {head}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      className={cx("cmdk-item", i === active && "is-active")}
                      onMouseEnter={() => setActive(i)}
                      onClick={it.run}
                    >
                      {it.icon}
                      <span className="cmdk-label">{it.label}</span>
                      {it.hint ? <span className="cmdk-hint">{it.hint}</span> : null}
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <div className="cmdk-foot">
            <span>
              <ArrowUpDown size={12} aria-hidden /> {m.palette.select}
            </span>
            <span>
              <CornerDownLeft size={12} aria-hidden /> {m.common.open}
            </span>
            <span>
              <kbd>Esc</kbd> {m.common.close}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
