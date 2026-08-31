import { getDb } from "@/lib/db";
import { listExperiences } from "@/resume/experiences";
import { ExperienceEditor } from "./experience-editor";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  const experiences = listExperiences(getDb());
  return (
    <div>
      <h1>Profile — 我的经历</h1>
      <p style={{ color: "#666", fontSize: 13, margin: "8px 0 16px" }}>
        像网申系统一样在这里录入你的教育、实习、项目、技能。生成简历时,Resume Studio 会按目标方向从这里挑选。
      </p>
      <ExperienceEditor initial={experiences} />
    </div>
  );
}
