import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { funnel, byDirection, networkingFunnel, crossStats, weekly } from "@/network/stats";
import { directionName, tierLabel } from "@/app/lib/labels";
import { PageHeader, Section, Stat, StatStrip } from "@/app/components/ui";
import { getLang, getMessages } from "@/i18n/server";
import type { Messages } from "@/i18n/messages";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).nav.dashboard };
}

type BarColor = "default" | "good" | "warn" | "muted";

function Bar({ label, value, max, color = "default" }: { label: string; value: number; max: number; color?: BarColor }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track" aria-hidden>
        <div className={color === "default" ? "bar-fill" : `bar-fill ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="bar-value">{value.toLocaleString()}</span>
    </div>
  );
}

function rate(num: number, den: number): string {
  return den > 0 ? `${Math.round((num / den) * 100)}%` : "—";
}

function delta(now: number, before: number, m: Messages): string {
  const d = now - before;
  const t = m.dashboard.stats;
  return d === 0 ? t.sameAsLastWeek : d > 0 ? t.moreThanLastWeek(d) : t.fewerThanLastWeek(-d);
}

// 统计: the funnels and comparisons. The "what needs me" list moved to 今日.
export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const m = await getMessages();
  const lang = await getLang();
  const t = m.dashboard;
  const db = getDb();
  const f = funnel(db, user.id);
  const byDir = byDirection(db, user.id);
  const nf = networkingFunnel(db, user.id);
  const cross = crossStats(db, user.id);
  const wk = weekly(db, user.id);
  const funnelMax = Math.max(1, ...Object.values(f));
  const nfMax = Math.max(1, ...Object.values(nf));

  return (
    <>
      <PageHeader title={m.nav.dashboard} />

      <StatStrip>
        <Stat label={t.stats.submitted} value={f.submitted.toLocaleString()} sub={t.stats.inLast7Days(wk.thisWeek.submittedApplications)} />
        <Stat label={t.stats.interviews} value={f.interview} tone="good" sub={t.stats.interviewRate(rate(f.interview, f.submitted))} />
        <Stat label={t.stats.offers} value={f.offer} tone="warn" />
        <Stat label={t.stats.newContactsThisWeek} value={wk.thisWeek.newOutreach} sub={delta(wk.thisWeek.newOutreach, wk.lastWeek.newOutreach, m)} />
      </StatStrip>

      <Section title={t.funnel.title}>
        <Bar label={t.funnel.discovered} value={f.discovered} max={funnelMax} />
        <Bar label={t.funnel.matched} value={f.matched} max={funnelMax} />
        <Bar label={t.funnel.submitted} value={f.submitted} max={funnelMax} color="good" />
        <Bar label={t.funnel.oa} value={f.oa} max={funnelMax} color="good" />
        <Bar label={t.funnel.interview} value={f.interview} max={funnelMax} color="good" />
        <Bar label={t.funnel.offer} value={f.offer} max={funnelMax} color="warn" />
        <Bar label={t.funnel.rejected} value={f.rejected} max={funnelMax} />
        <Bar label={t.funnel.archived} value={f.archived} max={funnelMax} color="muted" />
      </Section>

      <Section title={t.byTrack.title} description={t.byTrack.description}>
        {byDir.length === 0 ? (
          <p className="muted">{m.common.noData}</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t.byTrack.track}</th>
                  <th>{t.byTrack.tier}</th>
                  <th className="num">{t.byTrack.total}</th>
                  <th className="num">{t.byTrack.submitted}</th>
                  <th className="num">{t.byTrack.interviews}</th>
                </tr>
              </thead>
              <tbody>
                {byDir.map((r, i) => (
                  <tr key={i}>
                    <td>{directionName(r.direction, lang)}</td>
                    <td className="muted small">{tierLabel(r.tier, lang)}</td>
                    <td className="num">{r.total.toLocaleString()}</td>
                    <td className="num">{r.submitted}</td>
                    <td className="num">{r.interviews}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title={t.networking.title}>
        <Bar label={t.networking.drafts} value={nf.drafts} max={nfMax} />
        <Bar label={t.networking.pending} value={nf.pending} max={nfMax} />
        <Bar label={t.networking.sent} value={nf.sent} max={nfMax} color="good" />
        <Bar label={t.networking.replied} value={nf.replied} max={nfMax} color="good" />
        <Bar label={t.networking.meetings} value={nf.meetings} max={nfMax} color="warn" />
        <Bar label={t.networking.referrals} value={nf.referrals} max={nfMax} color="warn" />
      </Section>

      <Section title={t.referralVsDirect.title} description={t.referralVsDirect.description}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th className="num">{t.referralVsDirect.submitted}</th>
                <th className="num">{t.referralVsDirect.interviews}</th>
                <th className="num">{t.referralVsDirect.interviewRate}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t.referralVsDirect.withReferral}</td>
                <td className="num">{cross.withReferral.submitted}</td>
                <td className="num">{cross.withReferral.interviews}</td>
                <td className="num">{rate(cross.withReferral.interviews, cross.withReferral.submitted)}</td>
              </tr>
              <tr>
                <td>{t.referralVsDirect.direct}</td>
                <td className="num">{cross.without.submitted}</td>
                <td className="num">{cross.without.interviews}</td>
                <td className="num">{rate(cross.without.interviews, cross.without.submitted)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t.weekly.title}>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th className="num">{t.weekly.submitted}</th>
                <th className="num">{t.weekly.newContacts}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t.weekly.thisWeek}</td>
                <td className="num">{wk.thisWeek.submittedApplications}</td>
                <td className="num">{wk.thisWeek.newOutreach}</td>
              </tr>
              <tr>
                <td>{t.weekly.lastWeek}</td>
                <td className="num">{wk.lastWeek.submittedApplications}</td>
                <td className="num">{wk.lastWeek.newOutreach}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
