import { getDb } from "@/lib/db";
import { GeneratePanel } from "./generate-panel";

export const dynamic = "force-dynamic";

interface RRow { id: number; version_name: string; directions: string; pdf_path: string; compiled_at: string }

export default function StudioPage() {
  const rows = getDb().prepare("SELECT id, version_name, directions, pdf_path, compiled_at FROM resumes ORDER BY compiled_at DESC").all() as RRow[];
  const expCount = (getDb().prepare("SELECT COUNT(*) n FROM experiences").get() as { n: number }).n;
  return (
    <div>
      <h1>Resume Studio</h1>
      {expCount === 0 && <p style={{ color: "#b00" }}>还没有经历。先去 Profile 页录入经历,再回来生成简历。</p>}
      <GeneratePanel />
      <h3 style={{ marginTop: 20 }}>已生成的简历版本</h3>
      <table>
        <thead><tr><th>版本</th><th>方向</th><th>生成时间</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.version_name}</td>
              <td>{JSON.parse(r.directions).join(", ")}</td>
              <td>{r.compiled_at}</td>
              <td><a href={`/api/resumes/${r.id}/pdf`} target="_blank" rel="noreferrer">查看 PDF</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
