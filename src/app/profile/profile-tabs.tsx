"use client";
import { useState } from "react";
import { Tabs } from "@/app/components/ui";
import { ExperiencesTab } from "./experiences-tab";
import { ResumesTab } from "./resumes-tab";
import { AnswersTab } from "./answers-tab";
import type { Exp, ResumeRow } from "./profile-types";

export type ProfileTab = "experiences" | "resumes" | "answers";

export function ProfileTabs({ tab: initialTab, experiences, resumes, answers }: { tab: ProfileTab; experiences: Exp[]; resumes: ResumeRow[]; answers: Record<string, string> }) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  function select(key: string) {
    const t = key as ProfileTab;
    setTab(t);
    window.history.replaceState(null, "", t === "experiences" ? "/profile" : `/profile?tab=${t}`);
  }
  return (
    <>
      <Tabs
        ariaLabel="档案"
        value={tab}
        onChange={select}
        items={[
          { key: "experiences", label: "经历", count: experiences.length },
          { key: "resumes", label: "简历", count: resumes.length },
          { key: "answers", label: "标准答案", count: Object.keys(answers).length },
        ]}
      />
      {tab === "experiences" ? <ExperiencesTab initial={experiences} /> : tab === "resumes" ? <ResumesTab resumes={resumes} hasExperiences={experiences.length > 0} /> : <AnswersTab initial={answers} />}
    </>
  );
}
