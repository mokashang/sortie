"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button, Chip, ConfirmDialog, EmptyState, Input, LinkButton, Segmented, Skeleton, useToast } from "@/app/components/ui";
import { errorMessage, getJson, postJson } from "@/app/lib/api";
import { RANKING_FILTERS, filterCompanies, filterCounts, needsUser, pickable, type RankingFilter } from "@/app/lib/ranking";
import { useOverview } from "@/app/components/overview-context";
import { useMessages } from "@/i18n/client";
import type { RankedCompany, RankedState, RankingBoard as Board } from "@/apply/ranking";

const PAGE = 60;

function tone(s: RankedState): "good" | "warn" | "accent" | "neutral" {
  if (s === "submitted") return "good";
  if (needsUser(s)) return "warn";
  return s === "active" ? "accent" : "neutral";
}

// 天梯: the ranked list in the App. Companies in rank order, what became of each job, and the two
// ways to move it along: work down from a company (a relay of segments, one task at a time), or
// queue the picked jobs next. The list's task shows here too, with 暂停.
export function RankingBoard({ active }: { active: boolean }) {
  const m = useMessages();
  const t = m.apply.ranking;
  const { toast } = useToast();
  const { refresh: refreshOverview } = useOverview();
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState<RankingFilter>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [askFrom, setAskFrom] = useState<RankedCompany | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBoard(await getJson<Board>("/api/ranking"));
    } catch {
      // keep the last list
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 8000);
    return () => clearInterval(id);
  }, [active, refresh]);

  const companies = useMemo(() => filterCompanies(board?.companies ?? [], filter, query), [board, filter, query]);
  const counts = useMemo(() => filterCounts(board?.companies ?? []), [board]);

  if (!board) return <Skeleton height={120} />;

  const run = board.run;
  const left = (from: number) => board.companies.filter((c) => c.rank >= from).reduce((n, c) => n + c.jobs.filter((j) => j.state === "todo").length, 0);

  async function after() {
    await refresh();
    await refreshOverview();
  }

  async function startFrom(rank: number) {
    setBusy(true);
    try {
      const j = await postJson<{ runId: number; jobs: number }>("/api/ranking/start", { fromRank: rank });
      toast(j.jobs > 0 ? { title: t.started(j.runId), tone: "good" } : { title: t.nothingLeft });
      await after();
    } catch (e) {
      toast({ title: t.startFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
      setAskFrom(null);
    }
  }

  async function startPicked() {
    setBusy(true);
    try {
      const j = await postJson<{ started: number[]; skipped: number[] }>("/api/ranking/start", { jobIds: [...picked] });
      toast(j.started.length > 0 ? { title: t.pickedStarted(j.started.length), tone: "good" } : { title: t.pickedNone });
      setPicked(new Set());
      await after();
    } catch (e) {
      toast({ title: t.startFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  async function pause(runId: number) {
    setBusy(true);
    try {
      await postJson("/api/executor/stop", { runId });
      toast({ title: t.paused2, tone: "good" });
      await after();
    } catch (e) {
      toast({ title: t.pauseFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const runLabel = run ? (run.status === "running" ? t.running(run.id) : run.status === "paused" ? t.paused(run.id) : t.queued(run.id)) : null;

  return (
    <>
      <p className="muted small mb-2">{t.summary(board.total)}</p>
      <div className="rank-tools">
        {run ? (
          <>
            <Chip tone={run.status === "running" ? "accent" : "neutral"} title={run.summary ?? undefined}>
              {runLabel}
            </Chip>
            <Button size="sm" icon={<Pause size={13} />} onClick={() => pause(run.id)} disabled={busy}>
              {t.pause}
            </Button>
          </>
        ) : board.nextRank ? (
          <Button size="sm" variant="primary" icon={<Play size={13} />} onClick={() => setAskFrom(board.companies.find((c) => c.rank === board.nextRank) ?? null)} disabled={busy}>
            {t.continueFrom(board.nextRank)}
          </Button>
        ) : null}
        <span className="grow" />
        <Input value={query} placeholder={t.search} aria-label={t.search} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="mb-2">
        <Segmented<RankingFilter>
          size="sm"
          ariaLabel={t.sectionTitle}
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setShown(PAGE);
          }}
          options={RANKING_FILTERS.map((f) => ({ value: f, label: t.filters[f], count: counts[f] }))}
        />
      </div>
      {board.counts.login > 0 && (filter === "all" || filter === "you") ? (
        <p className="muted small mb-2">
          {t.loginHint(board.counts.login)}{" "}
          <LinkButton href="/apply?tab=todo" size="sm" variant="ghost">
            {t.goLogin}
          </LinkButton>
        </p>
      ) : null}

      {companies.length === 0 ? <EmptyState compact title={t.emptyTitle} description={t.emptyDescription} /> : null}
      {companies.slice(0, shown).map((c) => (
        <div key={c.rank} className="rank-row">
          <div className="rank-head">
            <span className="mono rank-no">{c.rank}</span>
            <span className="strong truncate">{c.company}</span>
            {c.value ? <span className="muted small mono">{c.value}</span> : null}
            <span className="grow" />
            {!run && c.jobs.some((j) => j.state === "todo") ? (
              <Button size="sm" variant="ghost" onClick={() => setAskFrom(c)} disabled={busy}>
                {t.fromHere}
              </Button>
            ) : null}
          </div>
          {c.jobs.length === 0 && c.note ? <p className="muted small rank-jobs">{c.note}</p> : null}
          {c.jobs.length > 0 ? (
            <ul className="rank-jobs">
              {c.jobs.map((j) => (
                <li key={j.jobId} className="rank-job" title={j.detail ?? undefined}>
                  <input type="checkbox" aria-label={j.title} checked={picked.has(j.jobId)} disabled={!pickable(j.state)} onChange={() => toggle(j.jobId)} />
                  <span className="mono rank-score">{j.score ?? ""}</span>
                  <Link href={`/queue?job=${j.jobId}`}>{j.title}</Link>
                  <span className="grow" />
                  <Chip tone={tone(j.state)}>{t.states[j.state]}</Chip>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      {companies.length > shown ? (
        <div className="row mt-3">
          <Button size="sm" variant="ghost" onClick={() => setShown((n) => n + PAGE)}>
            {t.showMore}
          </Button>
        </div>
      ) : null}

      {picked.size > 0 ? (
        <div className="rank-bar">
          <Button size="sm" variant="primary" onClick={startPicked} loading={busy}>
            {t.pickedButton(picked.size)}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())} disabled={busy}>
            {t.clear}
          </Button>
        </div>
      ) : null}

      <ConfirmDialog
        open={askFrom !== null}
        onClose={() => setAskFrom(null)}
        title={askFrom ? t.confirmTitle(askFrom.rank) : ""}
        description={askFrom ? t.confirmBody(left(askFrom.rank)) : undefined}
        confirmLabel={t.confirmStart}
        busy={busy}
        onConfirm={() => (askFrom ? startFrom(askFrom.rank) : undefined)}
      />
    </>
  );
}
