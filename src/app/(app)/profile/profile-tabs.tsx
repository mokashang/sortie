"use client";
import { useState } from "react";
import { Tabs } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";
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
  const m = useMessages();
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
        ariaLabel={m.profile.title}
        value={tab}
        onChange={select}
        items={[
          { key: "basics", label: complete ? m.profile.tabs.basics : m.profile.tabs.basicsIncomplete },
          { key: "experiences", label: m.profile.tabs.experiences, count: experiences.length },
          { key: "resumes", label: m.profile.tabs.resumes, count: resumes.length },
          { key: "answers", label: m.profile.tabs.answers, count: Object.keys(answers).length },
          { key: "documents", label: m.profile.tabs.documents, count: documents.length },
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
