"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, SearchX, Sparkles } from "lucide-react";
import { directionName, tierLabel } from "@/app/lib/labels";
import { ALL_JOBS_DIRECTION, type QueueModeKey, type QueueSortKey } from "@/app/lib/queue-const";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { useMediaQuery } from "@/app/lib/use-media";
import { cx } from "@/app/lib/cx";
import { Button, EmptyState, Field, Input, Segmented, Select, SkeletonRows, Tabs, useToast } from "@/app/components/ui";
import { ScanMenu } from "@/app/components/scan-menu";
import { useLang, useMessages } from "@/i18n/client";
import { JobRow, type JobRowData, type RowMode } from "./job-row";
import { JobDrawer, JobPanel } from "./job-drawer";

export interface TabInfo {
  direction: string;
  tier: number | null;
  matched: number;
  referralSuggested: number;
  directSuggested: number;
}

export interface PagedResult {
  rows: JobRowData[];
  total: number;
  pages: number;
}

interface Params {
  direction: string;
  page: number;
  sort: QueueSortKey;
  mode: QueueModeKey;
  query: string;
}

const defaultSortFor = (direction: string): QueueSortKey => (direction === ALL_JOBS_DIRECTION ? "fresh" : "composite");

const isTypingTarget = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
};

export interface QueueClientProps {
  tabs: TabInfo[];
  allJobsCount: number;
  initialDirection: string;
  initialPage: number;
  initialSort: QueueSortKey;
  initialMode: QueueModeKey;
  initialQuery: string;
  initialResult: PagedResult;
  // ?job=<id> opens that row's detail on arrival (links from the home page and the palette).
  initialJobId: number | null;
  pageSize: number;
}

export function QueueClient(props: QueueClientProps) {
  const m = useMessages();
  const lang = useLang();
  const { pageSize } = props;
  const [tabs, setTabs] = useState<TabInfo[]>(props.tabs);
  const [params, setParams] = useState<Params>({
    direction: props.initialDirection,
    page: props.initialPage,
    sort: props.initialSort,
    mode: props.initialMode,
    query: props.initialQuery,
  });
  const [queryInput, setQueryInput] = useState(props.initialQuery);
  const [result, setResult] = useState<PagedResult>(props.initialResult);
  const [loading, setLoading] = useState(false);
  const [activeId, setActiveId] = useState<number | null>(
    props.initialJobId != null && props.initialResult.rows.some((r) => r.id === props.initialJobId) ? props.initialJobId : null
  );
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [fitInfo, setFitInfo] = useState<{ unclassified: number; running: boolean } | null>(null);
  const wide = useMediaQuery("(min-width: 1200px)");
  const { toast } = useToast();
  const seq = useRef(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const rowsRef = useRef(result.rows);
  rowsRef.current = result.rows;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const isAllTab = params.direction === ALL_JOBS_DIRECTION;
  const currentTab = tabs.find((t) => t.direction === params.direction);

  const fetchPage = useCallback(
    async (p: Params) => {
      const mine = ++seq.current;
      setLoading(true);
      try {
        const sp = new URLSearchParams({ direction: p.direction, page: String(p.page), pageSize: String(pageSize), sort: p.sort });
        if (p.mode !== "all" && p.direction !== ALL_JOBS_DIRECTION) sp.set("mode", p.mode);
        if (p.query.trim()) sp.set("q", p.query.trim());
        const j = await getJson<PagedResult>(`/api/queue?${sp.toString()}`);
        if (mine === seq.current) setResult(j);
      } catch (e) {
        toast({ title: m.queue.toast.loadFailed, description: errorMessage(e), tone: "danger" });
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [pageSize, toast, m]
  );

  const fetchTabs = useCallback(async () => {
    try {
      const j = await getJson<{ groups: TabInfo[] }>("/api/queue/by-direction");
      setTabs(j.groups ?? []);
    } catch {
      // stale counts are non-fatal
    }
  }, []);

  const fetchFitInfo = useCallback(async () => {
    try {
      setFitInfo(await getJson<{ unclassified: number; running: boolean }>("/api/queue/referral-fit"));
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void fetchFitInfo();
  }, [fetchFitInfo]);

  // j / k walk the list, Esc closes the detail — only while nothing is being typed and no dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (document.querySelector("dialog[open], .cmdk, .drawer")) return;
      const rows = rowsRef.current;
      if (rows.length === 0) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const i = rows.findIndex((r) => r.id === activeRef.current);
        const next = e.key === "j" ? Math.min(rows.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
        setActiveId(rows[next].id);
        document.querySelectorAll<HTMLElement>(".job-row")[next]?.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Escape" && activeRef.current != null) {
        setActiveId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function syncUrl(p: Params) {
    const sp = new URLSearchParams({ direction: p.direction, page: String(p.page), sort: p.sort });
    if (p.mode !== "all") sp.set("mode", p.mode);
    if (p.query.trim()) sp.set("q", p.query.trim());
    window.history.replaceState(null, "", `/queue?${sp.toString()}`);
  }

  function apply(next: Partial<Params>) {
    const p = { ...paramsRef.current, ...next };
    setParams(p);
    syncUrl(p);
    void fetchPage(p);
  }

  function selectTab(direction: string) {
    if (direction === params.direction) return;
    // Each side has its own natural default sort; only swap when the user is still on the previous default.
    const wasDefault = params.sort === defaultSortFor(params.direction);
    setActiveId(null);
    apply({ direction, page: 1, sort: wasDefault ? defaultSortFor(direction) : params.sort });
  }

  function goToPage(page: number) {
    const clamped = Math.min(Math.max(1, page), result.pages);
    if (clamped !== params.page) apply({ page: clamped });
  }

  // Debounced search: commit 300ms after typing stops; Enter commits immediately.
  useEffect(() => {
    if (queryInput === paramsRef.current.query) return;
    const t = setTimeout(() => apply({ query: queryInput, page: 1 }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput]);

  async function withBusy(id: number, fn: () => Promise<void>) {
    setBusyIds((s) => new Set(s).add(id));
    try {
      await fn();
    } finally {
      setBusyIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }

  function togglePin(row: JobRowData, pinned: boolean) {
    void withBusy(row.id, async () => {
      try {
        await postJson("/api/queue/pin", { jobId: row.id, pinned });
        await fetchPage(paramsRef.current);
        toast({ title: pinned ? m.queue.toast.pinned(row.company) : m.queue.toast.unpinned(row.company), description: pinned ? m.queue.toast.pinnedDescription : undefined });
      } catch (e) {
        toast({ title: m.queue.toast.pinFailed, description: errorMessage(e), tone: "danger" });
      }
    });
  }

  function setRowMode(row: JobRowData, mode: RowMode) {
    void withBusy(row.id, async () => {
      try {
        await postJson("/api/queue/mode", { jobId: row.id, mode });
        await Promise.all([fetchPage(paramsRef.current), fetchTabs()]);
        toast({ title: mode === null ? m.queue.toast.modeReset(row.company) : mode === "referral" ? m.queue.toast.modeReferral(row.company) : m.queue.toast.modeDirect(row.company) });
      } catch (e) {
        toast({ title: m.queue.toast.modeFailed, description: errorMessage(e), tone: "danger" });
      }
    });
  }

  function skipRow(row: JobRowData) {
    const rows = result.rows;
    const i = rows.findIndex((r) => r.id === row.id);
    const nextActive = activeId === row.id ? (rows[i + 1] ?? rows[i - 1] ?? null) : null;
    setResult((prev) => ({ rows: prev.rows.filter((r) => r.id !== row.id), total: Math.max(0, prev.total - 1), pages: prev.pages }));
    if (activeId === row.id) setActiveId(nextActive ? nextActive.id : null);
    void (async () => {
      try {
        await postJson("/api/queue/archive", { jobId: row.id });
        void fetchTabs();
        toast({
          title: m.queue.toast.skipped(row.company, row.title),
          action: {
            label: m.common.undo,
            onClick: () => {
              void postJson("/api/queue/unarchive", { jobId: row.id })
                .then(() => Promise.all([fetchPage(paramsRef.current), fetchTabs()]))
                .then(() => toast({ title: m.queue.toast.restored(row.company), tone: "good" }))
                .catch((e) => toast({ title: m.queue.toast.undoFailed, description: errorMessage(e), tone: "danger" }));
            },
          },
        });
      } catch (e) {
        toast({ title: m.queue.toast.skipFailed, description: errorMessage(e), tone: "danger" });
        void fetchPage(paramsRef.current);
      }
    })();
  }

  async function runFit() {
    try {
      await postJson("/api/queue/referral-fit");
      setFitInfo((f) => ({ unclassified: f?.unclassified ?? 0, running: true }));
      toast({ title: m.queue.toast.fitRunning, description: m.queue.toast.fitRunningDescription, tone: "info" });
      const poll = async () => {
        try {
          const s = await getJson<{ unclassified: number; running: boolean }>("/api/queue/referral-fit");
          setFitInfo(s);
          if (s.running) setTimeout(poll, 5000);
          else {
            await Promise.all([fetchPage(paramsRef.current), fetchTabs()]);
            toast({ title: m.queue.toast.fitDone, tone: "good" });
          }
        } catch {
          setTimeout(poll, 5000);
        }
      };
      setTimeout(poll, 5000);
    } catch (e) {
      toast({ title: m.queue.toast.fitFailed, description: errorMessage(e), tone: "danger" });
    }
  }

  const activeRow = result.rows.find((r) => r.id === activeId) ?? null;
  const rowHandlers = { onPin: togglePin, onMode: setRowMode, onSkip: skipRow };
  const detailProps = {
    row: activeRow,
    rows: result.rows,
    allTab: isAllTab,
    busy: activeRow ? busyIds.has(activeRow.id) : false,
    onNavigate: setActiveId,
    onClose: () => setActiveId(null),
    ...rowHandlers,
  };

  return (
    <div>
      <Tabs
        ariaLabel={m.queue.tabs.ariaLabel}
        value={params.direction}
        onChange={selectTab}
        items={[
          ...tabs.map((t) => ({
            key: t.direction,
            label: (
              <>
                {directionName(t.direction, lang)}
                {t.tier != null ? (
                  <span className="tab-tier" title={tierLabel(t.tier, lang)}>
                    T{t.tier}
                  </span>
                ) : null}
              </>
            ),
            count: t.matched,
          })),
          { key: ALL_JOBS_DIRECTION, label: m.queue.tabs.allJobs, count: props.allJobsCount },
        ]}
      />

      <div className={cx("queue-split", wide && activeRow && "has-panel")}>
        <div className="queue-main">
          <div className="job-toolbar">
            <div className="job-search input-icon">
              <Search size={14} aria-hidden />
              <Input
                aria-label={m.queue.toolbar.searchPlaceholder}
                placeholder={m.queue.toolbar.searchPlaceholder}
                value={queryInput}
                small
                onChange={(e) => setQueryInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") apply({ query: queryInput, page: 1 });
                  if (e.key === "Escape") setQueryInput("");
                }}
              />
            </div>
            {!isAllTab ? (
              <Segmented<QueueModeKey>
                size="sm"
                ariaLabel={m.queue.toolbar.modeAriaLabel}
                value={params.mode}
                onChange={(mode) => apply({ mode, page: 1 })}
                options={[
                  { value: "all", label: m.common.all, count: currentTab?.matched },
                  { value: "referral", label: m.labels.mode.referral, count: currentTab?.referralSuggested },
                  { value: "direct", label: m.labels.mode.direct, count: currentTab?.directSuggested },
                ]}
              />
            ) : null}
            <Field inline label={m.queue.toolbar.sort} htmlFor="queue-sort">
              <Select id="queue-sort" small value={params.sort} onChange={(e) => apply({ sort: e.target.value as QueueSortKey, page: 1 })} style={{ width: "auto" }}>
                {!isAllTab ? <option value="composite">{m.queue.toolbar.sortComposite}</option> : null}
                <option value="score">{m.queue.toolbar.sortScore}</option>
                <option value="fresh">{isAllTab ? m.queue.toolbar.sortAdded : m.queue.toolbar.sortPosted}</option>
                <option value="company">{m.queue.toolbar.sortCompany}</option>
              </Select>
            </Field>
            <span className="grow" />
            {!isAllTab && fitInfo && (fitInfo.unclassified > 0 || fitInfo.running) ? (
              <Button size="sm" variant="ghost" icon={<Sparkles size={14} />} loading={fitInfo.running} onClick={runFit}>
                {m.queue.toolbar.fitButton(fitInfo.unclassified)}
              </Button>
            ) : null}
          </div>

          {result.rows.length === 0 ? (
            loading ? (
              <SkeletonRows rows={8} />
            ) : params.query.trim() ? (
              <EmptyState
                icon={<SearchX size={24} />}
                title={m.queue.empty.noMatch(params.query.trim())}
                description={m.queue.empty.noMatchDescription}
                action={<Button onClick={() => setQueryInput("")}>{m.queue.empty.clearSearch}</Button>}
              />
            ) : isAllTab ? (
              <EmptyState art="radar" title={m.queue.empty.noJobs} description={m.queue.empty.noJobsDescription} action={<ScanMenu variant="primary" />} />
            ) : (
              <EmptyState art="radar" title={m.queue.empty.noneInTrack} description={m.queue.empty.noneInTrackDescription} />
            )
          ) : (
            <div className={cx("job-list", loading && "is-loading")} aria-busy={loading}>
              {result.rows.map((r) => (
                <JobRow key={r.id} row={r} allTab={isAllTab} active={r.id === activeId} busy={busyIds.has(r.id)} onOpen={setActiveId} {...rowHandlers} />
              ))}
            </div>
          )}

          {result.pages > 1 ? (
            <div className="pagination">
              <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} disabled={loading || params.page <= 1} onClick={() => goToPage(params.page - 1)}>
                {m.queue.pagination.prev}
              </Button>
              <span>
                {m.queue.pagination.pageBefore}
                <span className="mono">{params.page}</span>
                {m.queue.pagination.pageBetween}
                <span className="mono">{result.pages}</span>
                {m.queue.pagination.pageAfter}
                <span className="mono">{result.total}</span>
                {m.queue.pagination.totalUnit(result.total)}
              </span>
              <Button variant="ghost" size="sm" disabled={loading || params.page >= result.pages} onClick={() => goToPage(params.page + 1)}>
                {m.queue.pagination.next} <ChevronRight size={14} aria-hidden />
              </Button>
            </div>
          ) : result.total > 0 ? (
            <p className="pagination">{m.queue.pagination.total(result.total)}</p>
          ) : null}
        </div>

        {wide ? <JobPanel {...detailProps} /> : null}
      </div>

      {!wide ? <JobDrawer {...detailProps} /> : null}
    </div>
  );
}
