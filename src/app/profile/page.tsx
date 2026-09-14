import { getDb } from "@/lib/db";
import { listExperiences } from "@/resume/experiences";
import { loadProfile } from "@/lib/profile";
import { PageHeader } from "@/app/components/ui";
import { ProfileTabs, type ProfileTab } from "./profile-tabs";
import type { ResumeRow } from "./profile-types";

export const dynamic = "force-dynamic";
export const metadata = { title: "档案" };

const TABS: ProfileTab[] = ["experiences", "resumes", "answers"];

// 档案: 经历 (what the resumes are built from) · 简历 (generated versions) · 标准答案 (what the
// assistant fills into application forms beyond contact/education/work-auth/EEO).
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab: ProfileTab = TABS.includes(sp.tab as ProfileTab) ? (sp.tab as ProfileTab) : "experiences";
  const db = getDb();
  const experiences = listExperiences(db);
  const resumes = (
    db.prepare("SELECT id, version_name, directions, compiled_at FROM resumes ORDER BY compiled_at DESC").all() as {
      id: number;
      version_name: string;
      directions: string;
      compiled_at: string;
    }[]
  ).map<ResumeRow>((r) => {
    let directions: string[] = [];
    try {
      directions = JSON.parse(r.directions);
    } catch {
      directions = [];
    }
    return { id: r.id, version_name: r.version_name, directions, compiled_at: r.compiled_at };
  });
  let answers: Record<string, string> = {};
  try {
    answers = loadProfile().standard_answers;
  } catch {
    answers = {};
  }
  return (
    <>
      <PageHeader title="档案" />
      <ProfileTabs tab={tab} experiences={experiences} resumes={resumes} answers={answers} />
    </>
  );
}
