import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { funnel, byDirection, networkingFunnel, crossStats, weekly } from "@/network/stats";
import { directionLabel } from "@/matcher/directions";
import { tierLabel } from "@/app/lib/labels";
import { PageHeader, Section, Stat, StatStrip } from "@/app/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "统计" };

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

function delta(now: number, before: number): string {
  const d = now - before;
  return d === 0 ? "与上周持平" : d > 0 ? `比上周多 ${d}` : `比上周少 ${-d}`;
}

// 统计: the funnels and comparisons. The "what needs me" list moved to 今日.
export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
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
      <PageHeader title="统计" subtitle="申请与人脉的漏斗、分方向进展、内推与海投的对比。" />

      <StatStrip>
        <Stat label="已投递" value={f.submitted.toLocaleString()} sub={`${wk.thisWeek.submittedApplications} 份在最近 7 天`} />
        <Stat label="面试" value={f.interview} tone="good" sub={rate(f.interview, f.submitted) + " 的投递进入面试"} />
        <Stat label="Offer" value={f.offer} tone="warn" />
        <Stat label="本周新增联系" value={wk.thisWeek.newOutreach} sub={delta(wk.thisWeek.newOutreach, wk.lastWeek.newOutreach)} />
      </StatStrip>

      <Section title="申请漏斗">
        <Bar label="发现" value={f.discovered} max={funnelMax} />
        <Bar label="已匹配" value={f.matched} max={funnelMax} />
        <Bar label="已投递" value={f.submitted} max={funnelMax} color="good" />
        <Bar label="OA" value={f.oa} max={funnelMax} color="good" />
        <Bar label="面试" value={f.interview} max={funnelMax} color="good" />
        <Bar label="Offer" value={f.offer} max={funnelMax} color="warn" />
        <Bar label="被拒" value={f.rejected} max={funnelMax} />
        <Bar label="已归档" value={f.archived} max={funnelMax} color="muted" />
      </Section>

      <Section title="分方向" description="每个方向队列里的职位数,以及已投递、进入面试的数量。">
        {byDir.length === 0 ? (
          <p className="muted">暂无数据。</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>方向</th>
                  <th>梯队</th>
                  <th className="num">总数</th>
                  <th className="num">投递</th>
                  <th className="num">面试</th>
                </tr>
              </thead>
              <tbody>
                {byDir.map((r, i) => (
                  <tr key={i}>
                    <td>{r.direction ? directionLabel(r.direction) : "未分类"}</td>
                    <td className="muted small">{tierLabel(r.tier)}</td>
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

      <Section title="人脉漏斗">
        <Bar label="草稿" value={nf.drafts} max={nfMax} />
        <Bar label="待发送" value={nf.pending} max={nfMax} />
        <Bar label="已发送" value={nf.sent} max={nfMax} color="good" />
        <Bar label="已回复" value={nf.replied} max={nfMax} color="good" />
        <Bar label="约到聊" value={nf.meetings} max={nfMax} color="warn" />
        <Bar label="拿到内推" value={nf.referrals} max={nfMax} color="warn" />
      </Section>

      <Section title="内推 vs 海投" description="有内推的申请和海投的申请,各自进入面试的比例。">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th className="num">投递</th>
                <th className="num">面试</th>
                <th className="num">面试转化率</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>有内推</td>
                <td className="num">{cross.withReferral.submitted}</td>
                <td className="num">{cross.withReferral.interviews}</td>
                <td className="num">{rate(cross.withReferral.interviews, cross.withReferral.submitted)}</td>
              </tr>
              <tr>
                <td>海投</td>
                <td className="num">{cross.without.submitted}</td>
                <td className="num">{cross.without.interviews}</td>
                <td className="num">{rate(cross.without.interviews, cross.without.submitted)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="最近 7 天 vs 之前 7 天">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th></th>
                <th className="num">已投递</th>
                <th className="num">新增联系</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>最近 7 天</td>
                <td className="num">{wk.thisWeek.submittedApplications}</td>
                <td className="num">{wk.thisWeek.newOutreach}</td>
              </tr>
              <tr>
                <td>之前 7 天</td>
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
