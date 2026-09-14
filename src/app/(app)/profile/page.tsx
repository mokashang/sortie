import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { listExperiences } from "@/resume/experiences";
import { emptyProfileData, getProfileData, profileStatus } from "@/lib/profile";
import { PageHeader } from "@/app/components/ui";
import { ProfileTabs, type ProfileTab } from "./profile-tabs";
import type { ResumeRow } from "./profile-types";

export const dynamic = "force-dynamic";
export const metadata = { title: "档案" };

const TABS: ProfileTab[] = ["basics", "experiences", "resumes", "answers"];

// 档案: 基本信息 (contact / education / work authorization / directions — what matching and the
// answer pack are built from) · 经历 (what the resumes are built from) · 简历 (generated versions)
// · 标准答案 (what the assistant fills into application forms beyond the basics).
export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string; welcome?: string }> }) {
  const user = await requireUser("/profile");
  const sp = await searchParams;
  const db = getDb();
  const status = profileStatus(db, user.id);
  const requested = TABS.includes(sp.tab as ProfileTab) ? (sp.tab as ProfileTab) : null;
  // A fresh account lands on the basics until they validate; everyone else defaults to 经历.
  const tab: ProfileTab = requested ?? (status.complete ? "experiences" : "basics");
  const experiences = listExperiences(db, user.id);
  const resumes = (
    db.prepare("SELECT id, version_name, directions, compiled_at FROM resumes WHERE user_id = ? ORDER BY compiled_at DESC").all(user.id) as {
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
  const profile = getProfileData(db, user.id) ?? emptyProfileData({ name: user.name, email: user.email });
  const answers = (profile.standard_answers ?? {}) as Record<string, string>;
  return (
    <>
      <PageHeader title="档案" subtitle="你的基本信息、经历、由此生成的简历版本,以及网申常见问题的标准答案。" />
      <ProfileTabs
        tab={tab}
        experiences={experiences}
        resumes={resumes}
        answers={answers}
        profile={profile}
        profileComplete={status.complete}
        welcome={sp.welcome === "1"}
        isOwner={user.role === "owner"}
      />
    </>
  );
}
