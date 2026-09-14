"use client";
import { useState } from "react";
import { Tabs } from "@/app/components/ui";
import { BasicsTab } from "./basics-tab";
import { ExperiencesTab } from "./experiences-tab";
import { ResumesTab } from "./resumes-tab";
import { AnswersTab } from "./answers-tab";
import { DocumentsTab, type DocumentRow } from "./documents-tab";
import type { Exp, ResumeRow } from "./profile-types";

export type ProfileTab = "basics" | "experiences" | "resumes" | "answers" | "documents";

export function ProfileTabs({
  tab: initialTab,
  experiences,
  resumes,
  answers,
  documents,
  profile,
  profileComplete,
  welcome,
  isOwner,
}: {
  tab: ProfileTab;
  experiences: Exp[];
  resumes: ResumeRow[];
  answers: Record<string, string>;
  documents: DocumentRow[];
  profile: Record<string, unknown>;
  profileComplete: boolean;
  welcome: boolean;
  isOwner: boolean;
}) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [complete, setComplete] = useState(profileComplete);
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
          { key: "basics", label: complete ? "基本信息" : "基本信息 · 待完善" },
          { key: "experiences", label: "经历", count: experiences.length },
          { key: "resumes", label: "简历", count: resumes.length },
          { key: "answers", label: "标准答案", count: Object.keys(answers).length },
          { key: "documents", label: "文件", count: documents.length },
        ]}
      />
      {tab === "basics" ? (
        <BasicsTab initial={profile} complete={complete} welcome={welcome} isOwner={isOwner} onSaved={() => setComplete(true)} />
      ) : tab === "experiences" ? (
        <ExperiencesTab initial={experiences} />
      ) : tab === "resumes" ? (
        <ResumesTab resumes={resumes} hasExperiences={experiences.length > 0} />
      ) : tab === "documents" ? (
        <DocumentsTab initial={documents} />
      ) : (
        <AnswersTab initial={answers} />
      )}
    </>
  );
}
