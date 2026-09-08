"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { getJson, patchJson, postJson, errorMessage } from "@/app/lib/api";
import { relativeTime } from "@/app/lib/time";
import { cx } from "@/app/lib/cx";
import { Button, Chip, EmptyState, Field, Input, Section, Select, SkeletonRows, Stat, StatStrip, useToast } from "@/app/components/ui";

type Tier = "core" | "longtail" | "dormant" | "muted";
const TIERS: Tier[] = ["core", "longtail", "dormant", "muted"];
const TIER_LABEL: Record<Tier, string> = { core: "核心 · 每小时", longtail: "长尾 · 每天", dormant: "休眠 · 每周", muted: "静音" };
const FAMILIES = ["greenhouse", "lever", "ashby", "workday", "bytedance", "smartrecruiters", "oracle", "icims", "workable", "amazon", "linkedin", "github_list", "chrome"];
const ORIGIN_LABEL: Record<string, string> = { seed: "种子", directory: "目录", url: "链接发现", builtin: "内置" };

interface FamilySummary {
  family: string;
  core: number;
  longtail: number;
  dormant: number;
  muted: number;
  jobs30: number;
  ge75_30: number;
  errors24h: number;
}
interface BoardView {
  key: string;
  family: string;
  ident: string;
  company: string | null;
  origin: string;
  tier: Tier;
  tier_reason: string | null;
  tier_locked: number;
  last_polled_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  fail_count: number;
  next_due_at: string | null;
  jobs30: number;
  ge75_30: number;
}
interface BoardEvent {
  at: string;
  key: string;
  from: string;
  to: string;
  reason: string;
}
interface Data {
  families: FamilySummary[];
  lastTick: { at: string; payload: { boards: number; inserted: number; errors: { key: string; error: string }[] } } | null;
  rows: BoardView[];
  total: number;
  pages: number;
  events: BoardEvent[];
}

export function SourcesBoard() {
  const [family, setFamily] = useState("");
  const [tier, setTier] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState("");
  const { toast } = useToast();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (family) params.set("family", family);
    if (tier) params.set("tier", tier);
    if (q) params.set("q", q);
    try {
      setData(await getJson<Data>(`/api/sources?${params.toString()}`));
    } catch (e) {
      toast({ title: "加载失败", description: errorMessage(e), tone: "danger" });
    }
  }, [family, tier, q, page, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(label: string, fn: () => Promise<Record<string, unknown>>, describe?: (j: Record<string, unknown>) => string) {
    setBusy(label);
    try {
      const j = await fn();
      toast({ title: `${label}完成`, description: describe?.(j), tone: "good" });
      await load();
    } catch (e) {
      toast({ title: `${label}失败`, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy("");
    }
  }

  const setBoardTier = (key: string, t: Tier) => act("改层级", () => patchJson("/api/sources/board", { key, tier: t }));
  const totals = data?.families.reduce((a, f) => ({ boards: a.boards + f.core + f.longtail + f.dormant + f.muted, jobs30: a.jobs30 + f.jobs30, good: a.good + f.ge75_30, errors: a.errors + f.errors24h }), { boards: 0, jobs30: 0, good: 0, errors: 0 });

  return (
    <div>
      {data && totals ? (
        <StatStrip compact>
          <Stat label="板块" value={totals.boards.toLocaleString()} />
          <Stat label="30 天新职位" value={totals.jobs30.toLocaleString()} />
          <Stat label="30 天 ≥75 分" value={totals.good.toLocaleString()} tone="accent" />
          <Stat label="24 小时出错" value={totals.errors} tone={totals.errors > 0 ? "warn" : undefined} />
        </StatStrip>
      ) : null}

      <Section
        title="按来源家族"
        description={
          data?.lastTick
            ? `上次检查 ${relativeTime(data.lastTick.at)}:问了 ${data.lastTick.payload.boards} 个板块,新增 ${data.lastTick.payload.inserted} 个职位,${data.lastTick.payload.errors?.length ?? 0} 个出错。点一行只看该家族。`
            : "还没有检查记录。"
        }
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={13} />}
            loading={busy === "导入开源目录"}
            title="一次性把开源目录里 4700 多家公司加为长尾板块;再点只补新增"
            onClick={() => act("导入开源目录", () => postJson("/api/sources/import-directory"), (j) => `新增 ${j.inserted} 个板块,已有 ${j.skipped} 个,三天内自动铺开。`)}
          >
            导入开源目录
          </Button>
        }
      >
        {!data ? (
          <SkeletonRows rows={6} />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>家族</th>
                  <th className="num">核心</th>
                  <th className="num">长尾</th>
                  <th className="num">休眠</th>
                  <th className="num">静音</th>
                  <th className="num">30 天新职位</th>
                  <th className="num">30 天 ≥75</th>
                  <th className="num">24h 出错</th>
                </tr>
              </thead>
              <tbody>
                {data.families.map((f) => (
                  <tr
                    key={f.family}
                    className={cx("row-click", family === f.family && "is-active")}
                    onClick={() => {
                      setFamily(family === f.family ? "" : f.family);
                      setPage(1);
                    }}
                  >
                    <td className="mono">{f.family}</td>
                    <td className="num">{f.core}</td>
                    <td className="num">{f.longtail}</td>
                    <td className="num">{f.dormant}</td>
                    <td className="num">{f.muted}</td>
                    <td className="num">{f.jobs30}</td>
                    <td className="num strong">{f.ge75_30}</td>
                    <td className={cx("num", f.errors24h > 0 && "text-danger")}>{f.errors24h}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="板块" count={data?.total}>
        <div className="job-toolbar">
          <Field inline label="家族" htmlFor="src-family">
            <Select id="src-family" small value={family} onChange={(e) => { setFamily(e.target.value); setPage(1); }} style={{ width: "auto" }}>
              <option value="">全部</option>
              {FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field inline label="层级" htmlFor="src-tier">
            <Select id="src-tier" small value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }} style={{ width: "auto" }}>
              <option value="">全部</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {TIER_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="job-search input-icon">
            <Search size={14} aria-hidden />
            <Input small placeholder="搜公司或板块键" aria-label="搜索板块" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        {!data ? (
          <SkeletonRows rows={8} />
        ) : data.rows.length === 0 ? (
          <EmptyState compact title="没有匹配的板块" />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>公司 / 板块</th>
                  <th>家族</th>
                  <th>层级</th>
                  <th>上次问</th>
                  <th className="num">30 天新职位</th>
                  <th className="num">30 天 ≥75</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((b) => (
                  <tr key={b.key}>
                    <td>
                      <div className="serif strong">{b.company ?? b.ident}</div>
                      <div className="mono muted xs">
                        {b.key}
                        {b.tier_locked ? " · 手动" : ""}
                        {ORIGIN_LABEL[b.origin] ? ` · ${ORIGIN_LABEL[b.origin]}` : ""}
                      </div>
                    </td>
                    <td className="mono">{b.family}</td>
                    <td>
                      <Select small value={b.tier} onChange={(e) => setBoardTier(b.key, e.target.value as Tier)} disabled={!!busy || b.family === "chrome"} style={{ width: "auto" }} aria-label={`${b.company ?? b.ident} 的层级`}>
                        {TIERS.map((t) => (
                          <option key={t} value={t}>
                            {TIER_LABEL[t]}
                          </option>
                        ))}
                      </Select>
                      {b.tier_reason ? <div className="muted xs">{b.tier_reason}</div> : null}
                    </td>
                    <td>
                      <span title={b.last_polled_at ?? undefined}>{relativeTime(b.last_polled_at)}</span>
                      {b.last_error ? (
                        <div className="text-danger xs truncate" style={{ maxWidth: 260 }} title={b.last_error}>
                          {b.last_error}
                        </div>
                      ) : null}
                    </td>
                    <td className="num">{b.jobs30}</td>
                    <td className="num strong">{b.ge75_30}</td>
                    <td>
                      {b.family !== "chrome" ? (
                        <div className="row row-nowrap" style={{ justifyContent: "flex-end" }}>
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act("问一次", () => postJson("/api/sources/poll", { key: b.key }), (j) => `新增 ${j.inserted} 个职位${Array.isArray(j.errors) && j.errors.length ? ",有错误,见板块行" : ""}。`)}>
                            问一次
                          </Button>
                          {b.tier === "muted" ? (
                            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setBoardTier(b.key, "longtail")}>
                              恢复
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setBoardTier(b.key, "muted")}>
                              静音
                            </Button>
                          )}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.pages > 1 ? (
          <div className="pagination">
            <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span>
              第 <span className="mono">{page}</span> / <span className="mono">{data.pages}</span> 页 · 共 <span className="mono">{data.total}</span> 个
            </span>
            <Button variant="ghost" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
              下一页 <ChevronRight size={14} aria-hidden />
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title="最近升降级">
        {!data ? (
          <SkeletonRows rows={3} />
        ) : data.events.length === 0 ? (
          <p className="muted small">还没有记录。</p>
        ) : (
          <ul className="event-list">
            {data.events.map((e, i) => (
              <li key={i}>
                <span className="mono muted xs">{e.at}</span> <span className="mono">{e.key}</span> <Chip outline>{e.from}</Chip> → <Chip>{e.to}</Chip> <span className="muted small">{e.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
