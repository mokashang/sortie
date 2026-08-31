import { getDb } from "@/lib/db";
import { funnel, byDirection, networkingFunnel, crossStats, weekly, todo } from "@/network/stats";

export const dynamic = "force-dynamic";

const BAR_TRACK: React.CSSProperties = {
  background: "#e5e5ef",
  borderRadius: 4,
  height: 16,
  flex: 1,
  overflow: "hidden",
};

function Bar({ label, value, max, color = "#3d5afe" }: { label: string; value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }}>
      <span style={{ width: 90, fontSize: 13, color: "#555" }}>{label}</span>
      <div style={BAR_TRACK}>
        <div style={{ width: `${pct}%`, background: color, height: "100%" }} />
      </div>
      <span style={{ width: 32, textAlign: "right", fontSize: 13, fontWeight: 600 }}>{value}</span>
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

      <section style={{ background: "#fff", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3>申请漏斗</h3>
        <Bar label="发现" value={f.discovered} max={funnelMax} />
        <Bar label="已匹配" value={f.matched} max={funnelMax} />
        <Bar label="已投递" value={f.submitted} max={funnelMax} color="#2a7a2a" />
        <Bar label="OA" value={f.oa} max={funnelMax} color="#2a7a2a" />
        <Bar label="面试" value={f.interview} max={funnelMax} color="#2a7a2a" />
        <Bar label="Offer" value={f.offer} max={funnelMax} color="#c9a227" />
        <Bar label="被拒" value={f.rejected} max={funnelMax} color="#b00" />
        <Bar label="已归档" value={f.archived} max={funnelMax} color="#999" />
      </section>

      <section style={{ background: "#fff", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3>分方向</h3>
        {byDir.length === 0 ? (
          <p style={{ color: "#666" }}>暂无数据。</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>方向</th>
                <th>梯队</th>
                <th>总数</th>
                <th>投递</th>
                <th>面试</th>
              </tr>
            </thead>
            <tbody>
              {byDir.map((r, i) => (
                <tr key={i}>
                  <td>{r.direction ?? "—"}</td>
                  <td>{r.tier ?? "—"}</td>
                  <td>{r.total}</td>
                  <td>{r.submitted}</td>
                  <td>{r.interviews}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ background: "#fff", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3>Networking 漏斗</h3>
        <Bar label="草稿" value={nf.drafts} max={nfMax} />
        <Bar label="待发送" value={nf.pending} max={nfMax} />
        <Bar label="已发送" value={nf.sent} max={nfMax} color="#2a7a2a" />
        <Bar label="已回复" value={nf.replied} max={nfMax} color="#2a7a2a" />
        <Bar label="约到聊" value={nf.meetings} max={nfMax} color="#c9a227" />
        <Bar label="拿到内推" value={nf.referrals} max={nfMax} color="#c9a227" />
      </section>

      <section style={{ background: "#fff", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3>Referral vs 海投</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>投递数</th>
              <th>面试数</th>
              <th>面试转化率</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>有内推</td>
              <td>{cross.withReferral.submitted}</td>
              <td>{cross.withReferral.interviews}</td>
              <td>
                {cross.withReferral.submitted > 0
                  ? `${Math.round((cross.withReferral.interviews / cross.withReferral.submitted) * 100)}%`
                  : "—"}
              </td>
            </tr>
            <tr>
              <td>海投</td>
              <td>{cross.without.submitted}</td>
              <td>{cross.without.interviews}</td>
              <td>
                {cross.without.submitted > 0
                  ? `${Math.round((cross.without.interviews / cross.without.submitted) * 100)}%`
                  : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ background: "#fff", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h3>本周 vs 上周</h3>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>已投递</th>
              <th>新增 Outreach</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>本周</td>
              <td>{wk.thisWeek.submittedApplications}</td>
              <td>{wk.thisWeek.newOutreach}</td>
            </tr>
            <tr>
              <td>上周</td>
              <td>{wk.lastWeek.submittedApplications}</td>
              <td>{wk.lastWeek.newOutreach}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ background: "#fff", borderRadius: 8, padding: 16 }}>
        <h3>待办</h3>
        <p>
          去确认(<a href="/apply">投递</a>):<strong>{td.pendingConfirms}</strong>
        </p>
        <p>
          去批准(<a href="/network">人脉</a>):<strong>{td.pendingSends}</strong>
        </p>
        <div>
          该 followup 的人(发送后超过 5 天无回复):
          {td.staleFollowups.length === 0 ? (
            <span style={{ color: "#666" }}> 无。</span>
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
