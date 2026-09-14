"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, MessageSquare, Play } from "lucide-react";
import { directionLabel } from "@/matcher/directions";
import type { Overview } from "@/app/lib/overview-types";
import { attentionTotal } from "@/app/lib/overview-types";
import { formatDateZh, relativeDays } from "@/app/lib/time";
import { getJson } from "@/app/lib/api";
import { cx } from "@/app/lib/cx";
import { Card, Chip, EmptyState, LinkButton, PageHeader, Section, Stat, StatStrip } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { AssistantCard } from "@/app/components/assistant-card";
import { ScanMenu } from "@/app/components/scan-menu";
import { ConfirmCards } from "@/app/apply/confirm-cards";
import { InfoCards } from "@/app/apply/info-cards";
import { ReferralBoard } from "@/app/apply/referral-board";

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
          队列前排 <span className="muted" style={{ fontWeight: 500 }}>· {directionLabel(dir)}</span>
        </>
      }
      actions={
        <Link href={`/queue?direction=${encodeURIComponent(dir)}`} className="small accent">
          看全部 →
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
              {r.effective_mode === "referral" ? <Chip tone="good">内推</Chip> : null}
              <span className="mono">{relativeDays(r.posted_at).label}</span>
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

export function TodayClient({ initial }: { initial: Overview }) {
  const { data } = useOverview();
  const o = data ?? initial;
  const c = o.counts;
  const attention = attentionTotal(c);
  const referralAttention = c.referralDrafts + c.referralProgress;
  const nothingToDo = attention === 0 && c.networkDrafts === 0;

  return (
    <>
      <PageHeader
        kicker={formatDateZh(new Date())}
        title={attention === 0 ? "今天没有需要你决定的事" : `有 ${attention} 件事等你决定`}
        actions={
          <>
            <LinkButton href="/apply#plan" variant="primary" icon={<Play size={14} />}>
              开始投递
            </LinkButton>
            <ScanMenu />
          </>
        }
      />

      <AssistantCard variant="compact" />

      <StatStrip>
        <Stat label="队列可投" value={c.queueMatched.toLocaleString()} href="/queue" hint="分数达标、未归档、未投的职位" />
        <Stat label="今日已提交" value={c.submittedToday} href="/history" tone={c.submittedToday > 0 ? "good" : undefined} />
        <Stat label="本周已提交" value={c.submittedThisWeek} href="/history" />
        <Stat label="内推进行中" value={c.referralInFlight} href="/apply#referrals" tone={c.referralInFlight > 0 ? "accent" : undefined} />
      </StatStrip>

      <Section title="需要你处理" count={attention > 0 ? attention : undefined}>
        <div className="col gap-3">
          <InfoCards compact />
          <ConfirmCards compact />
          {referralAttention > 0 ? <ReferralBoard onlyAttention /> : null}
          {c.networkDrafts > 0 ? (
            <LinkCard
              icon={<MessageSquare size={18} />}
              title={`${c.networkDrafts} 条 coffee chat 草稿待你批准`}
              description="人脉页的草稿只有你批准后,助手才会发送。"
              href="/network"
              cta="去批准"
            />
          ) : null}
          {nothingToDo ? (
            <EmptyState
              art="inbox"
              title="收件箱是空的"
              description="助手填好的申请、缺的答案、待批的内推留言都会出现在这里。"
              action={
                <LinkButton href="/apply#plan" icon={<Play size={14} />}>
                  安排一次投递
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
