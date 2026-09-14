"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { getJson, patchJson, postJson, errorMessage } from "@/app/lib/api";
import { labelOf } from "@/app/lib/labels";
import { relativeTime } from "@/app/lib/time";
import { cx } from "@/app/lib/cx";
import { Button, Chip, EmptyState, Field, Input, Section, Select, SkeletonRows, Stat, StatStrip, useToast } from "@/app/components/ui";
import { useLang, useMessages } from "@/i18n/client";

type Tier = "core" | "longtail" | "dormant" | "muted";
const TIERS: Tier[] = ["core", "longtail", "dormant", "muted"];
const FAMILIES = ["greenhouse", "lever", "ashby", "workday", "bytedance", "smartrecruiters", "oracle", "icims", "workable", "amazon", "linkedin", "github_list", "chrome"];
// Which of sources.actions this in-flight request belongs to — an internal identifier, not text.
type ActionKind = "retier" | "import" | "poll";

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
  const m = useMessages();
  const lang = useLang();
  const [family, setFamily] = useState("");
  const [tier, setTier] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<ActionKind | "">("");
  const { toast } = useToast();

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (family) params.set("family", family);
    if (tier) params.set("tier", tier);
    if (q) params.set("q", q);
    try {
      setData(await getJson<Data>(`/api/sources?${params.toString()}`));
    } catch (e) {
      toast({ title: m.sources.loadFailed, description: errorMessage(e), tone: "danger" });
    }
  }, [family, tier, q, page, toast, m]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(kind: ActionKind, fn: () => Promise<Record<string, unknown>>, describe?: (j: Record<string, unknown>) => string) {
    setBusy(kind);
    const msgs = m.sources.actions[kind];
    try {
      const j = await fn();
      toast({ title: msgs.done, description: describe?.(j), tone: "good" });
      await load();
    } catch (e) {
      toast({ title: msgs.failed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy("");
    }
  }

  const setBoardTier = (key: string, t: Tier) => act("retier", () => patchJson("/api/sources/board", { key, tier: t }));
  const totals = data?.families.reduce(
    (a, f) => ({ boards: a.boards + f.core + f.longtail + f.dormant + f.muted, jobs30: a.jobs30 + f.jobs30, good: a.good + f.ge75_30, errors: a.errors + f.errors24h }),
    { boards: 0, jobs30: 0, good: 0, errors: 0 }
  );

  return (
    <div>
      {data && totals ? (
        <StatStrip compact>
          <Stat label={m.sources.stats.boards} value={totals.boards.toLocaleString()} />
          <Stat label={m.sources.stats.jobs30} value={totals.jobs30.toLocaleString()} />
          <Stat label={m.sources.stats.good30} value={totals.good.toLocaleString()} tone="accent" />
          <Stat label={m.sources.stats.errors24h} value={totals.errors} tone={totals.errors > 0 ? "warn" : undefined} />
        </StatStrip>
      ) : null}

      <Section
        title={m.sources.families.title}
        description={
          data?.lastTick
            ? m.sources.families.lastTick(relativeTime(data.lastTick.at, lang), data.lastTick.payload.boards, data.lastTick.payload.inserted, data.lastTick.payload.errors?.length ?? 0)
            : m.sources.families.noTick
        }
        actions={
          <Button
            size="sm"
            variant="ghost"
            icon={<Download size={13} />}
            loading={busy === "import"}
            title={m.sources.importHint}
            onClick={() => act("import", () => postJson("/api/sources/import-directory"), (j) => m.sources.importResult(Number(j.inserted), Number(j.skipped)))}
          >
            {m.sources.actions.import.label}
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
                  <th>{m.sources.families.columns.family}</th>
                  <th className="num">{m.sources.families.columns.core}</th>
                  <th className="num">{m.sources.families.columns.longtail}</th>
                  <th className="num">{m.sources.families.columns.dormant}</th>
                  <th className="num">{m.sources.families.columns.muted}</th>
                  <th className="num">{m.sources.families.columns.jobs30}</th>
                  <th className="num">{m.sources.families.columns.good30}</th>
                  <th className="num">{m.sources.families.columns.errors24h}</th>
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

      <Section title={m.sources.boards.title} count={data?.total}>
        <div className="job-toolbar">
          <Field inline label={m.sources.boards.family} htmlFor="src-family">
            <Select
              id="src-family"
              small
              value={family}
              onChange={(e) => {
                setFamily(e.target.value);
                setPage(1);
              }}
              style={{ width: "auto" }}
            >
              <option value="">{m.common.all}</option>
              {FAMILIES.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field inline label={m.sources.boards.tier} htmlFor="src-tier">
            <Select
              id="src-tier"
              small
              value={tier}
              onChange={(e) => {
                setTier(e.target.value);
                setPage(1);
              }}
              style={{ width: "auto" }}
            >
              <option value="">{m.common.all}</option>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {labelOf(m.sources.tiers, t)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="job-search input-icon">
            <Search size={14} aria-hidden />
            <Input
              small
              placeholder={m.sources.boards.searchPlaceholder}
              aria-label={m.sources.boards.searchAria}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        {!data ? (
          <SkeletonRows rows={8} />
        ) : data.rows.length === 0 ? (
          <EmptyState compact title={m.sources.boards.empty} />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{m.sources.boards.columns.board}</th>
                  <th>{m.sources.boards.columns.family}</th>
                  <th>{m.sources.boards.columns.tier}</th>
                  <th>{m.sources.boards.columns.lastPolled}</th>
                  <th className="num">{m.sources.boards.columns.jobs30}</th>
                  <th className="num">{m.sources.boards.columns.good30}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((b) => {
                  const origin = labelOf(m.sources.origins, b.origin, "");
                  return (
                    <tr key={b.key}>
                      <td>
                        <div className="serif strong">{b.company ?? b.ident}</div>
                        <div className="mono muted xs">
                          {b.key}
                          {b.tier_locked ? m.sources.boards.manualSuffix : ""}
                          {origin ? ` · ${origin}` : ""}
                        </div>
                      </td>
                      <td className="mono">{b.family}</td>
                      <td>
                        <Select
                          small
                          value={b.tier}
                          onChange={(e) => setBoardTier(b.key, e.target.value as Tier)}
                          disabled={!!busy || b.family === "chrome"}
                          style={{ width: "auto" }}
                          aria-label={m.sources.boards.tierAria(b.company ?? b.ident)}
                        >
                          {TIERS.map((t) => (
                            <option key={t} value={t}>
                              {labelOf(m.sources.tiers, t)}
                            </option>
                          ))}
                        </Select>
                        {b.tier_reason ? <div className="muted xs">{b.tier_reason}</div> : null}
                      </td>
                      <td>
                        <span title={b.last_polled_at ?? undefined}>{relativeTime(b.last_polled_at, lang)}</span>
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
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={!!busy}
                              onClick={() =>
                                act("poll", () => postJson("/api/sources/poll", { key: b.key }), (j) => m.sources.pollResult(Number(j.inserted), Array.isArray(j.errors) && j.errors.length > 0))
                              }
                            >
                              {m.sources.actions.poll.label}
                            </Button>
                            {b.tier === "muted" ? (
                              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setBoardTier(b.key, "longtail")}>
                                {m.sources.boards.unmute}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setBoardTier(b.key, "muted")}>
                                {m.sources.boards.mute}
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && data.pages > 1 ? (
          <div className="pagination">
            <Button variant="ghost" size="sm" icon={<ChevronLeft size={14} />} disabled={page <= 1} onClick={() => setPage(page - 1)}>
              {m.sources.pagination.prev}
            </Button>
            <span>
              {m.sources.pagination.pagePrefix}
              <span className="mono">{page}</span>
              {m.sources.pagination.pageSep}
              <span className="mono">{data.pages}</span>
              {m.sources.pagination.pageSuffix}
              <span className="mono">{data.total}</span>
              {m.sources.pagination.totalSuffix}
            </span>
            <Button variant="ghost" size="sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>
              {m.sources.pagination.next} <ChevronRight size={14} aria-hidden />
            </Button>
          </div>
        ) : null}
      </Section>

      <Section title={m.sources.events.title}>
        {!data ? (
          <SkeletonRows rows={3} />
        ) : data.events.length === 0 ? (
          <p className="muted small">{m.sources.events.none}</p>
        ) : (
          <ul className="event-list">
            {data.events.map((e, i) => (
              <li key={i}>
                <span className="mono muted xs">{e.at}</span> <span className="mono">{e.key}</span> <Chip outline>{e.from}</Chip> → <Chip>{e.to}</Chip>{" "}
                <span className="muted small">{e.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
