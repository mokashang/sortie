"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getJson, postJson, putJson, errorMessage } from "@/app/lib/api";
import { useIsMobile } from "@/app/lib/use-media";
import { Drawer, Section, useToast } from "@/app/components/ui";
import { useOverview } from "@/app/components/overview-context";
import { useMessages } from "@/i18n/client";
import { DraftsCards } from "./drafts-cards";
import { ContactsPane } from "./contacts-pane";
import { ContactDetail } from "./contact-detail";
import { PersonDialog } from "./person-dialog";
import { DraftDialog } from "./draft-dialog";
import type { JobLite, OutreachRow, Person, SendableRow } from "./network-types";

export function NetworkClient() {
  const m = useMessages();
  const [people, setPeople] = useState<Person[]>([]);
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [drafts, setDrafts] = useState<OutreachRow[]>([]);
  const [sendables, setSendables] = useState<SendableRow[]>([]);
  const [edited, setEdited] = useState<Record<number, string>>({});
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedOutreach, setSelectedOutreach] = useState<OutreachRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [relation, setRelation] = useState("");
  const [personOpen, setPersonOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { refresh: refreshOverview } = useOverview();

  const jobMap = useMemo(() => new Map(jobs.map((j) => [j.id, j])), [jobs]);

  const refreshAll = useCallback(async () => {
    try {
      const [p, d, s] = await Promise.all([
        getJson<{ people: Person[] }>("/api/network/people"),
        getJson<{ outreach: OutreachRow[] }>("/api/network/outreach?status=draft&jobLinked=false"),
        getJson<{ sendables: SendableRow[] }>("/api/network/sendables?jobLinked=false"),
      ]);
      setPeople(p.people ?? []);
      const rows = d.outreach ?? [];
      setDrafts(rows);
      setEdited((prev) => {
        const next = { ...prev };
        for (const row of rows) if (!(row.id in next)) next[row.id] = row.draft ?? "";
        return next;
      });
      setSendables(s.sendables ?? []);
    } catch {
      // transient — keep the last known lists
    }
  }, []);

  const refreshSelected = useCallback(async (personId: number) => {
    try {
      const j = await getJson<{ outreach: OutreachRow[] }>(`/api/network/outreach?personId=${personId}`);
      setSelectedOutreach(j.outreach ?? []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    getJson<{ jobs: JobLite[] }>("/api/jobs?all=1")
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void refreshAll();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshAll();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshAll]);

  useEffect(() => {
    if (selectedId != null) void refreshSelected(selectedId);
  }, [selectedId, refreshSelected]);

  async function act(id: number, fn: () => Promise<void>, okTitle: string) {
    setBusyId(id);
    try {
      await fn();
      toast({ title: okTitle, tone: "good" });
      await refreshAll();
      if (selectedId != null) await refreshSelected(selectedId);
      await refreshOverview();
    } catch (e) {
      toast({ title: m.common.failed, description: errorMessage(e), tone: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  const approve = (row: OutreachRow) =>
    act(
      row.id,
      async () => {
        const text = edited[row.id] ?? row.draft ?? "";
        if (text !== (row.draft ?? "")) await putJson("/api/network/outreach", { outreachId: row.id, draft: text });
        await postJson("/api/network/decide", { outreachId: row.id, decision: "approve" });
      },
      m.network.actions.approved(row.personName)
    );
  const reject = (row: OutreachRow) =>
    act(row.id, () => postJson("/api/network/decide", { outreachId: row.id, decision: "reject" }).then(() => {}), m.network.actions.rejected(row.personName));
  const markSent = (row: SendableRow) =>
    act(row.id, () => postJson("/api/network/report", { outreachId: row.id, event: "sent" }).then(() => {}), m.network.actions.markedSent(row.personName));
  const outcome = (row: OutreachRow, oc: "meeting" | "referral_won" | "no_response") =>
    act(row.id, () => postJson("/api/network/outcome", { outreachId: row.id, outcome: oc }).then(() => {}), m.network.actions.outcomeRecorded);

  const q = query.trim().toLowerCase();
  const filtered = people.filter(
    (p) => (!relation || p.relation === relation) && (!q || p.name.toLowerCase().includes(q) || (p.company ?? "").toLowerCase().includes(q))
  );
  const selected = people.find((p) => p.id === selectedId) ?? null;

  const detail = <ContactDetail person={selected} outreach={selectedOutreach} jobMap={jobMap} onDraft={() => setDraftOpen(true)} onOutcome={outcome} busyId={busyId} />;

  return (
    <>
      <DraftsCards drafts={drafts} sendables={sendables} edited={edited} onEdit={(id, text) => setEdited((p) => ({ ...p, [id]: text }))} onApprove={approve} onReject={reject} onMarkSent={markSent} busyId={busyId} />

      <Section title={m.network.contacts.title} count={people.length}>
        <div className="network-grid">
          <ContactsPane
            people={filtered}
            total={people.length}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={() => setPersonOpen(true)}
            query={query}
            setQuery={setQuery}
            relation={relation}
            setRelation={setRelation}
          />
          {!isMobile ? <div className="contact-detail-pane">{detail}</div> : null}
        </div>
      </Section>

      {isMobile ? (
        <Drawer open={selected !== null} onClose={() => setSelectedId(null)} title={selected?.name ?? ""} subtitle={[selected?.company, selected?.role_title].filter(Boolean).join(" · ")}>
          {detail}
        </Drawer>
      ) : null}

      <PersonDialog open={personOpen} onClose={() => setPersonOpen(false)} onSaved={refreshAll} />
      <DraftDialog
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        people={people}
        defaultPersonId={selectedId}
        onCreated={async () => {
          await refreshAll();
          if (selectedId != null) await refreshSelected(selectedId);
        }}
      />
    </>
  );
}
