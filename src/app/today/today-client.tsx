"use client";
import { ArrowRight, Inbox, MessageSquare, Play } from "lucide-react";
import type { Overview } from "@/app/lib/overview-types";
import { attentionTotal } from "@/app/lib/overview-types";
import { formatDateZh } from "@/app/lib/time";
import { Card, EmptyState, LinkButton, PageHeader, Section, Stat, StatStrip } from "@/app/components/ui";
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
        title={formatDateZh(new Date())}
        subtitle={attention === 0 ? "今天没有需要你决定的事。" : `有 ${attention} 件事等你决定。`}
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
              icon={<Inbox size={26} />}
              title="收件箱是空的"
              description="助手填好的申请、缺的答案、待批的内推留言都会出现在这里。现在可以看看队列前排,或开始一次投递。"
              action={
                <LinkButton href="/queue" icon={<ArrowRight size={14} />}>
                  看职位队列
                </LinkButton>
              }
            />
          ) : null}
        </div>
      </Section>

      <StatStrip>
        <Stat label="队列可投" value={c.queueMatched} href="/queue" hint="分数达标、未归档、未投的职位" />
        <Stat label="今日已提交" value={c.submittedToday} href="/history" tone={c.submittedToday > 0 ? "good" : undefined} />
        <Stat label="本周已提交" value={c.submittedThisWeek} href="/history" />
        <Stat label="内推进行中" value={c.referralInFlight} href="/apply#referrals" />
      </StatStrip>
    </>
  );
}
