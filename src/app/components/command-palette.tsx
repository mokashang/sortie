"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Briefcase, CornerDownLeft, Monitor, Moon, Play, Search, Sun } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { getJson } from "@/app/lib/api";
import { ALL_JOBS_DIRECTION } from "@/app/lib/queue-const";
import { getTheme, setTheme, type Theme } from "@/app/lib/settings";
import { cx } from "@/app/lib/cx";
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
const THEME_LABEL: Record<Theme, string> = { light: "浅色", dark: "深色", system: "跟随系统" };

// ⌘K: pages, a few actions, and a live search over every job in the library. Navigation only —
// nothing here submits, sends or starts a task without the page's own confirmation.
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
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
      .filter((n) => !term || n.label.toLowerCase().includes(term) || n.href.includes(term))
      .map((n) => {
        const Icon = n.icon;
        return { key: `page:${n.href}`, group: "页面", label: n.label, hint: "打开", icon: <Icon size={16} />, run: go(n.href) };
      });
    const theme = typeof window === "undefined" ? "system" : getTheme();
    const ThemeIcon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
    const actions: Item[] = [
      { key: "act:apply", group: "动作", label: "开始一次投递", hint: "投递页", icon: <Play size={16} />, run: go("/apply#plan") },
      { key: "act:queue", group: "动作", label: "看职位队列前排", hint: "职位页", icon: <Briefcase size={16} />, run: go("/queue") },
      {
        key: "act:theme",
        group: "动作",
        label: `切换外观 · 现在是${THEME_LABEL[theme]}`,
        hint: THEME_LABEL[THEME_NEXT[theme]],
        icon: <ThemeIcon size={16} />,
        run: () => {
          setTheme(THEME_NEXT[theme]);
          onClose();
        },
      },
    ].filter((a) => !term || String(a.label).toLowerCase().includes(term) || "投递扫描外观队列".includes(term));
    const hits: Item[] = jobs.map((j) => {
      const dir = j.in_queue === 1 && j.direction ? j.direction : ALL_JOBS_DIRECTION;
      const sp = new URLSearchParams({ direction: dir, q: j.company });
      return {
        key: `job:${j.id}`,
        group: "职位",
        label: (
          <>
            <span className="strong">{j.company}</span>
            <span className="muted">{j.title}</span>
          </>
        ),
        hint: j.score != null ? `${j.score} 分${j.direction ? ` · ${directionLabel(j.direction)}` : ""}` : "未打分",
        icon: <Briefcase size={16} />,
        run: go(`/queue?${sp.toString()}`),
      };
    });
    return term.length >= 2 ? [...hits, ...pages, ...actions] : [...pages, ...actions];
  }, [q, jobs, router, onClose]);

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
        <div className="cmdk" role="dialog" aria-modal="true" aria-label="搜索与跳转" onKeyDown={onKeyDown}>
          <div className="cmdk-input-row">
            <Search size={16} aria-hidden />
            <input
              ref={inputRef}
              className="cmdk-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜公司、职位,或输入要去的页面…"
              aria-label="搜索"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="cmdk-list" ref={listRef} role="listbox">
            {items.length === 0 ? (
              <div className="cmdk-empty">{q.trim().length >= 2 ? "没有匹配的职位或页面。" : "输入关键词开始。"}</div>
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
              <ArrowUpDown size={12} aria-hidden /> 选择
            </span>
            <span>
              <CornerDownLeft size={12} aria-hidden /> 打开
            </span>
            <span>
              <kbd>Esc</kbd> 关闭
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
