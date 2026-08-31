import { getDb } from "@/lib/db";
import { funnel, byDirection, networkingFunnel, crossStats, weekly, todo } from "@/network/stats";

export const dynamic = "force-dynamic";

type BarColor = "default" | "good" | "warn" | "muted";

function Bar({ label, value, max, color = "default" }: { label: string; value: number; max: number; color?: BarColor }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const fillClass = color === "default" ? "bar-fill" : `bar-fill ${color}`;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className={fillClass} style={{ width: `${pct}%` }} />
      </div>
      <span className="bar-value">{value}</span>
    </div>
  );
}

export default function DashboardPage() {
  const db = getDb();

  const f = funnel(db);
  const byDir = byDirection(db);
  const nf = networkingFunnel(db);
  const cross = crossStats(db);
  const wk = weekly(db);
  const td = todo(db);

  const funnelMax = Math.max(1, ...Object.values(f));
  const nfMax = Math.max(1, ...Object.values(nf));

  return (
    <div>
      <h1>Dashboard</h1>

      <section className="panel">
        <div className="panel-title">申请漏斗</div>
        <Bar label="发现" value={f.discovered} max={funnelMax} />
        <Bar label="已匹配" value={f.matched} max={funnelMax} />
        <Bar label="已投递" value={f.submitted} max={funnelMax} color="good" />
        <Bar label="OA" value={f.oa} max={funnelMax} color="good" />
        <Bar label="面试" value={f.interview} max={funnelMax} color="good" />
        <Bar label="Offer" value={f.offer} max={funnelMax} color="warn" />
        <Bar label="被拒" value={f.rejected} max={funnelMax} />
        <Bar label="已归档" value={f.archived} max={funnelMax} color="muted" />
      </section>

      <section className="panel">
        <div className="panel-title">分方向</div>
        {byDir.length === 0 ? (
          <p className="text-sub">暂无数据。</p>
        ) : (
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
                  <td>{r.direction ?? "—"}</td>
                  <td>{r.tier ?? "—"}</td>
                  <td className="num">{r.total}</td>
                  <td className="num">{r.submitted}</td>
                  <td className="num">{r.interviews}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <div className="panel-title">Networking 漏斗</div>
        <Bar label="草稿" value={nf.drafts} max={nfMax} />
        <Bar label="待发送" value={nf.pending} max={nfMax} />
        <Bar label="已发送" value={nf.sent} max={nfMax} color="good" />
        <Bar label="已回复" value={nf.replied} max={nfMax} color="good" />
        <Bar label="约到聊" value={nf.meetings} max={nfMax} color="warn" />
        <Bar label="拿到内推" value={nf.referrals} max={nfMax} color="warn" />
      </section>

      <section className="panel">
        <div className="panel-title">Referral vs 海投</div>
        <table>
          <thead>
            <tr>
              <th></th>
              <th className="num">投递数</th>
              <th className="num">面试数</th>
              <th className="num">面试转化率</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>有内推</td>
              <td className="num">{cross.withReferral.submitted}</td>
              <td className="num">{cross.withReferral.interviews}</td>
              <td className="num">
                {cross.withReferral.submitted > 0
                  ? `${Math.round((cross.withReferral.interviews / cross.withReferral.submitted) * 100)}%`
                  : "—"}
              </td>
            </tr>
            <tr>
              <td>海投</td>
              <td className="num">{cross.without.submitted}</td>
              <td className="num">{cross.without.interviews}</td>
              <td className="num">
                {cross.without.submitted > 0
                  ? `${Math.round((cross.without.interviews / cross.without.submitted) * 100)}%`
                  : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-title">本周 vs 上周</div>
        <table>
          <thead>
            <tr>
              <th></th>
              <th className="num">已投递</th>
              <th className="num">新增 Outreach</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>本周</td>
              <td className="num">{wk.thisWeek.submittedApplications}</td>
              <td className="num">{wk.thisWeek.newOutreach}</td>
            </tr>
            <tr>
              <td>上周</td>
              <td className="num">{wk.lastWeek.submittedApplications}</td>
              <td className="num">{wk.lastWeek.newOutreach}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-title">待办</div>
        <p>
          去确认(<a href="/apply">投递</a>):<strong>{td.pendingConfirms}</strong>
        </p>
        <p>
          去批准(<a href="/network">人脉</a>):<strong>{td.pendingSends}</strong>
        </p>
        <div>
          该 followup 的人(发送后超过 5 天无回复):
          {td.staleFollowups.length === 0 ? (
            <span className="text-sub"> 无。</span>
          ) : (
            <ul style={{ listStyle: "none", marginTop: 8 }}>
              {td.staleFollowups.map((s) => (
                <li key={s.outreachId} style={{ fontSize: 14, margin: "4px 0" }}>
                  {s.personName}
                  {s.personCompany ? ` · ${s.personCompany}` : ""} — {s.daysSince} 天前发送,尚无回复
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
