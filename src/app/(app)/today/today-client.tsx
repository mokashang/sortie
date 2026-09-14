"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, MessageSquare, Play, UserRound } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import type { Overview } from "@/app/lib/overview-types";
import { attentionTotal } from "@/app/lib/overview-types";
import { formatDate, relativeDays } from "@/app/lib/time";
import { getJson } from "@/app/lib/api";
import { cx } from "@/app/lib/cx";
import { Card, Chip, EmptyState, LinkButton, PageHeader, Section, Stat, StatStrip } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { AssistantCard } from "@/app/components/assistant-card";
import { ScanMenu } from "@/app/components/scan-menu";
import { ConfirmCards } from "@/app/(app)/apply/confirm-cards";
import { InfoCards } from "@/app/(app)/apply/info-cards";
import { ReferralBoard } from "@/app/(app)/apply/referral-board";
import { useLang, useMessages } from "@/i18n/client";

function LinkCard({ icon, title, description, href, cta }: { icon: React.ReactNode; title: string; description: string; href: string; cta: string }) {
  return (
    <Card className="link-card">
      <div className="row between row-nowrap">
        <div className="row row-nowrap">
          <span className="link-card-icon" aria-hidden>
            {icon}
          </span>
          <div>
            <div className="strong">{title}</div>
            <div className="muted small">{description}</div>
          </div>
        </div>
        <LinkButton href={href} size="sm" icon={<ArrowRight size={14} />}>
          {cta}
        </LinkButton>
      </div>
    </Card>
  );
}

interface FrontRow {
  id: number;
  company: string;
  title: string;
  score: number | null;
  posted_at: string | null;
  effective_mode?: "referral" | "direct";
}

// The five best rows of the primary direction, so the home page always shows what the next
// sortie would be — even on a day with nothing to decide.
function QueueFront() {
  const m = useMessages();
  const lang = useLang();
  const [state, setState] = useState<{ direction: string; rows: FrontRow[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g = await getJson<{ groups: { direction: string; matched: number }[] }>("/api/queue/by-direction");
        const first = g.groups?.find((x) => x.matched > 0);
        if (!first) {
          if (!cancelled) setState({ direction: "", rows: [] });
          return;
        }
        const sp = new URLSearchParams({ direction: first.direction, page: "1", pageSize: "5", sort: "composite" });
        const r = await getJson<{ rows: FrontRow[] }>(`/api/queue?${sp.toString()}`);
        if (!cancelled) setState({ direction: first.direction, rows: r.rows ?? [] });
      } catch {
        if (!cancelled) setState({ direction: "", rows: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state || state.rows.length === 0) return null;
  const dir = state.direction;
  return (
    <Section
      title={
        <>
          {m.today.front.title} <span className="muted" style={{ fontWeight: 500 }}>· {directionLabel(dir)}</span>
        </>
      }
      actions={
        <Link href={`/queue?direction=${encodeURIComponent(dir)}`} className="small accent">
          {m.today.front.seeAll}
        </Link>
      }
    >
      <div className="mini-jobs">
        {state.rows.map((r) => (
          <Link key={r.id} href={`/queue?direction=${encodeURIComponent(dir)}&q=${encodeURIComponent(r.company)}&job=${r.id}`} className="mini-job">
            <span className={cx("mini-score", (r.score ?? 0) >= 90 && "is-top")}>{r.score ?? "—"}</span>
            <span className="mini-main">
              <span className="mini-company">{r.company}</span>
              <span className="mini-title truncate">{r.title}</span>
            </span>
            <span className="mini-side">
              {r.effective_mode === "referral" ? <Chip tone="good">{m.labels.mode.referral}</Chip> : null}
              <span className="mono">{relativeDays(r.posted_at, lang).label}</span>
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

export function TodayClient({ initial }: { initial: Overview }) {
  const m = useMessages();
  const lang = useLang();
  const { data } = useOverview();
  const o = data ?? initial;
  const c = o.counts;
  const attention = attentionTotal(c);
  const referralAttention = c.referralDrafts + c.referralProgress;
  const nothingToDo = attention === 0 && c.networkDrafts === 0;

  return (
    <>
      <PageHeader
        kicker={formatDate(new Date(), lang)}
        title={attention === 0 ? m.today.head.nothingToDecide : m.today.head.toDecide(attention)}
        actions={
          <>
            <LinkButton href="/apply#plan" variant="primary" icon={<Play size={14} />}>
              {m.today.head.startApply}
            </LinkButton>
            <ScanMenu />
          </>
        }
      />

      {!o.profileComplete ? (
        <div className="setup-banner">
          <LinkCard
            icon={<UserRound size={18} />}
            title={m.today.profileGate.title}
            description={m.today.profileGate.description}
            href="/profile?tab=basics"
            cta={m.today.profileGate.cta}
          />
        </div>
      ) : null}

      <AssistantCard variant="compact" />

      <StatStrip>
        <Stat label={m.today.stats.queueReady} value={c.queueMatched.toLocaleString()} href="/queue" hint={m.today.stats.queueReadyHint} />
        <Stat label={m.today.stats.submittedToday} value={c.submittedToday} href="/history" tone={c.submittedToday > 0 ? "good" : undefined} />
        <Stat label={m.today.stats.submittedThisWeek} value={c.submittedThisWeek} href="/history" />
        <Stat label={m.today.stats.referralsInProgress} value={c.referralInFlight} href="/apply?tab=referrals" tone={c.referralInFlight > 0 ? "accent" : undefined} />
      </StatStrip>

      <Section title={m.today.inbox.title} count={attention > 0 ? attention : undefined}>
        <div className="col gap-3">
          <InfoCards compact />
          <ConfirmCards compact />
          {referralAttention > 0 ? <ReferralBoard onlyAttention /> : null}
          {c.networkDrafts > 0 ? (
            <LinkCard
              icon={<MessageSquare size={18} />}
              title={m.today.inbox.networkDrafts(c.networkDrafts)}
              description={m.today.inbox.networkDraftsDescription}
              href="/network"
              cta={m.today.inbox.goApprove}
            />
          ) : null}
          {nothingToDo ? (
            <EmptyState
              art="inbox"
              title={m.today.inbox.emptyTitle}
              description={m.today.inbox.emptyDescription}
              action={
                <LinkButton href="/apply#plan" icon={<Play size={14} />}>
                  {m.today.inbox.planApply}
                </LinkButton>
              }
            />
          ) : null}
        </div>
      </Section>

      <QueueFront />
    </>
  );
}
