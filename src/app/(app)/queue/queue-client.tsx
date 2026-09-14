"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Search, SearchX, Sparkles } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import { ALL_JOBS_DIRECTION, type QueueModeKey, type QueueSortKey } from "@/app/lib/queue-const";
import { getJson, postJson, errorMessage } from "@/app/lib/api";
import { useMediaQuery } from "@/app/lib/use-media";
import { cx } from "@/app/lib/cx";
import { Button, EmptyState, Field, Input, Segmented, Select, SkeletonRows, Tabs, useToast } from "@/app/components/ui";
import { ScanMenu } from "@/app/components/scan-menu";
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
        toast({ title: "加载队列失败", description: errorMessage(e), tone: "danger" });
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [pageSize, toast]
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
        toast({ title: pinned ? `已置顶 ${row.company}` : `已取消置顶 ${row.company}`, description: pinned ? "助手投递时会优先取置顶的职位。" : undefined });
      } catch (e) {
        toast({ title: "置顶失败", description: errorMessage(e), tone: "danger" });
      }
    });
  }

  function setRowMode(row: JobRowData, mode: RowMode) {
    void withBusy(row.id, async () => {
      try {
        await postJson("/api/queue/mode", { jobId: row.id, mode });
        await Promise.all([fetchPage(paramsRef.current), fetchTabs()]);
        toast({ title: mode === null ? `${row.company} 已改回跟随建议` : `${row.company} 已改为${mode === "referral" ? "找内推" : "海投"}` });
      } catch (e) {
        toast({ title: "修改失败", description: errorMessage(e), tone: "danger" });
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
          title: `已跳过 ${row.company} · ${row.title}`,
          action: {
            label: "撤销",
            onClick: () => {
              void postJson("/api/queue/unarchive", { jobId: row.id })
                .then(() => Promise.all([fetchPage(paramsRef.current), fetchTabs()]))
                .then(() => toast({ title: `已恢复 ${row.company}`, tone: "good" }))
                .catch((e) => toast({ title: "撤销失败", description: errorMessage(e), tone: "danger" }));
            },
          },
        });
      } catch (e) {
        toast({ title: "跳过失败", description: errorMessage(e), tone: "danger" });
        void fetchPage(paramsRef.current);
      }
    })();
  }

  async function runFit() {
    try {
      await postJson("/api/queue/referral-fit");
      setFitInfo((f) => ({ unclassified: f?.unclassified ?? 0, running: true }));
      toast({ title: "正在补判内推建议…", description: "助手逐条判断,完成后自动刷新。", tone: "info" });
      const poll = async () => {
        try {
          const s = await getJson<{ unclassified: number; running: boolean }>("/api/queue/referral-fit");
          setFitInfo(s);
          if (s.running) setTimeout(poll, 5000);
          else {
            await Promise.all([fetchPage(paramsRef.current), fetchTabs()]);
            toast({ title: "内推建议已更新", tone: "good" });
          }
        } catch {
          setTimeout(poll, 5000);
        }
      };
      setTimeout(poll, 5000);
    } catch (e) {
      toast({ title: "补判失败", description: errorMessage(e), tone: "danger" });
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
        ariaLabel="方向"
        value={params.direction}
        onChange={selectTab}
        items={[
          ...tabs.map((t) => ({
            key: t.direction,
            label: (
              <>
                {directionLabel(t.direction)}
                {t.tier != null ? (
                  <span className="tab-tier" title={`梯队 ${t.tier}`}>
                    T{t.tier}
                  </span>
                ) : null}
              </>
            ),
            count: t.matched,
          })),
          { key: ALL_JOBS_DIRECTION, label: "全部入库", count: props.allJobsCount },
        ]}
      />

      <div className={cx("queue-split", wide && activeRow && "has-panel")}>
        <div className="queue-main">
          <div className="job-toolbar">
            <div className="job-search input-icon">
              <Search size={14} aria-hidden />
              <Input
                aria-label="搜公司或职位名"
                placeholder="搜公司或职位名"
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
                ariaLabel="投递方式"
                value={params.mode}
                onChange={(mode) => apply({ mode, page: 1 })}
                options={[
                  { value: "all", label: "全部", count: currentTab?.matched },
                  { value: "referral", label: "内推", count: currentTab?.referralSuggested },
                  { value: "direct", label: "海投", count: currentTab?.directSuggested },
                ]}
              />
            ) : null}
            <Field inline label="排序" htmlFor="queue-sort">
              <Select id="queue-sort" small value={params.sort} onChange={(e) => apply({ sort: e.target.value as QueueSortKey, page: 1 })} style={{ width: "auto" }}>
                {!isAllTab ? <option value="composite">综合(分数 × 新鲜度)</option> : null}
                <option value="score">分数</option>
                <option value="fresh">{isAllTab ? "入库时间" : "发布时间"}</option>
                <option value="company">公司名</option>
              </Select>
            </Field>
            <span className="grow" />
            {!isAllTab && fitInfo && (fitInfo.unclassified > 0 || fitInfo.running) ? (
              <Button size="sm" variant="ghost" icon={<Sparkles size={14} />} loading={fitInfo.running} onClick={runFit}>
                补判内推建议 · 未判 {fitInfo.unclassified}
              </Button>
            ) : null}
          </div>

          {result.rows.length === 0 ? (
            loading ? (
              <SkeletonRows rows={8} />
            ) : params.query.trim() ? (
              <EmptyState icon={<SearchX size={24} />} title={`没有匹配「${params.query.trim()}」的职位`} description="换个关键词,或清空搜索。" action={<Button onClick={() => setQueryInput("")}>清空搜索</Button>} />
            ) : isAllTab ? (
              <EmptyState art="radar" title="还没有入库的职位" description="先扫描一次,信息源里的职位会进到这里。" action={<ScanMenu variant="primary" />} />
            ) : (
              <EmptyState art="radar" title="这个方向暂时没有可投的职位" description="队列会随扫描和打分自动补充;也可以看看别的方向。" />
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
                上一页
              </Button>
              <span>
                第 <span className="mono">{params.page}</span> / <span className="mono">{result.pages}</span> 页 · 共 <span className="mono">{result.total}</span> 条
              </span>
              <Button variant="ghost" size="sm" disabled={loading || params.page >= result.pages} onClick={() => goToPage(params.page + 1)}>
                下一页 <ChevronRight size={14} aria-hidden />
              </Button>
            </div>
          ) : result.total > 0 ? (
            <p className="pagination">共 {result.total} 条</p>
          ) : null}
        </div>

        {wide ? <JobPanel {...detailProps} /> : null}
      </div>

      {!wide ? <JobDrawer {...detailProps} /> : null}
    </div>
  );
}
