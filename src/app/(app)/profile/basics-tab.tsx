"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Upload } from "lucide-react";
import { DIRECTIONS } from "@/matcher/directions";
import { putJson, postJson, errorMessage, ApiError } from "@/app/lib/api";
import { Button, Card, Checkbox, Field, Input, Section, Segmented, Select, useToast } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";

// 档案 → 基本信息 (spec 2026-09-13 accounts §6): the fields the matcher and the answer pack are
// built from. Saves the whole profile at once (PUT /api/profile validates it server-side and
// returns per-field issues); the assistant cannot match or apply until it validates.

type Tier = 0 | 1 | 2 | 3;
interface Draft {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  school: string;
  degree: string;
  grad_date: string;
  work_auth: { status: string; needs_sponsorship: boolean };
  targets: { primary: "newgrad" | "intern"; secondary: "newgrad" | "intern" | "" };
  directions: Record<string, number>;
  daily_minutes_budget: number;
  eeo: { gender: string; race: string; veteran: string; disability: string };
}

const GENDER = ["Male", "Female", "Non-binary", "Decline to self-identify"];
const RACE = [
  "Asian",
  "Black or African American",
  "Hispanic or Latino",
  "White",
  "Native American or Alaska Native",
  "Native Hawaiian or Other Pacific Islander",
  "Two or More Races",
  "Decline to self-identify",
];
const VETERAN = ["I am not a protected veteran", "I identify as one or more of the classifications of a protected veteran", "I don't wish to answer"];
const DISABILITY = ["No, I do not have a disability", "Yes, I have a disability (or previously had a disability)", "I do not want to answer"];

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function toDraft(raw: Record<string, unknown>): Draft {
  const wa = (raw.work_auth ?? {}) as Record<string, unknown>;
  const tg = (raw.targets ?? {}) as Record<string, unknown>;
  const eeo = (raw.eeo ?? {}) as Record<string, unknown>;
  const dirs: Record<string, number> = {};
  for (const [k, v] of Object.entries((raw.directions ?? {}) as Record<string, unknown>)) {
    const n = Number(v);
    if (k in DIRECTIONS && n >= 1 && n <= 3) dirs[k] = n;
  }
  return {
    name: str(raw.name),
    email: str(raw.email),
    phone: str(raw.phone),
    linkedin: str(raw.linkedin),
    github: str(raw.github),
    school: str(raw.school),
    degree: str(raw.degree),
    grad_date: str(raw.grad_date),
    work_auth: { status: str(wa.status) || "F-1", needs_sponsorship: wa.needs_sponsorship !== false },
    targets: { primary: tg.primary === "intern" ? "intern" : "newgrad", secondary: tg.secondary === "intern" ? "intern" : tg.secondary === "newgrad" ? "newgrad" : "" },
    directions: dirs,
    daily_minutes_budget: Number(raw.daily_minutes_budget) || 90,
    eeo: {
      gender: str(eeo.gender) || "Decline to self-identify",
      race: str(eeo.race) || "Decline to self-identify",
      veteran: str(eeo.veteran) || "I am not a protected veteran",
      disability: str(eeo.disability) || "I do not want to answer",
    },
  };
}

function toPayload(d: Draft, standardAnswers: unknown): Record<string, unknown> {
  return {
    name: d.name.trim(),
    email: d.email.trim(),
    phone: d.phone.trim(),
    linkedin: d.linkedin.trim(),
    github: d.github.trim(),
    school: d.school.trim(),
    degree: d.degree.trim(),
    grad_date: d.grad_date.trim(),
    work_auth: { status: d.work_auth.status.trim(), needs_sponsorship: d.work_auth.needs_sponsorship },
    targets: d.targets.secondary ? { primary: d.targets.primary, secondary: d.targets.secondary } : { primary: d.targets.primary },
    directions: d.directions,
    daily_minutes_budget: d.daily_minutes_budget,
    eeo: d.eeo,
    standard_answers: standardAnswers && typeof standardAnswers === "object" ? standardAnswers : {},
  };
}

export function BasicsTab({ initial, complete, welcome, isOwner, onSaved }: { initial: Record<string, unknown>; complete: boolean; welcome: boolean; isOwner: boolean; onSaved: () => void }) {
  const m = useMessages();
  const TIER_LABEL: Record<Tier, string> = m.profile.basics.tierChoice;
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  function patch(p: Partial<Draft>) {
    setD((prev) => ({ ...prev, ...p }));
    setDirty(true);
  }
  function setDirection(slug: string, tier: Tier) {
    const next = { ...d.directions };
    if (tier === 0) delete next[slug];
    else next[slug] = tier;
    patch({ directions: next });
  }

  async function save() {
    setBusy(true);
    setIssues({});
    try {
      await putJson("/api/profile", { profile: toPayload(d, initial.standard_answers) });
      setDirty(false);
      onSaved();
      toast({ title: m.profile.basics.saved, description: m.profile.basics.savedDescription, tone: "good" });
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        // Server-side zod issues come back as {issues:[{path,message}]} — surface them per field.
        try {
          const r = await fetch("/api/profile", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile: toPayload(d, initial.standard_answers) }) });
          const j = (await r.json()) as { issues?: { path: string; message: string }[] };
          const map: Record<string, string> = {};
          for (const i of j.issues ?? []) map[i.path] = i.message;
          setIssues(map);
        } catch {
          /* fall through to the toast */
        }
        toast({ title: m.profile.basics.invalid, description: m.profile.basics.invalidDescription, tone: "warn" });
      } else {
        toast({ title: m.profile.basics.saveFailed, description: errorMessage(e), tone: "danger" });
      }
    } finally {
      setBusy(false);
    }
  }

  async function importYaml() {
    setImporting(true);
    try {
      const j = await postJson<{ profile: Record<string, unknown> }>("/api/profile", {});
      setD(toDraft(j.profile));
      setDirty(false);
      onSaved();
      toast({ title: m.profile.basics.imported, tone: "good" });
      router.refresh();
    } catch (e) {
      toast({ title: m.profile.basics.importFailed, description: errorMessage(e), tone: "danger" });
    } finally {
      setImporting(false);
    }
  }

  const err = (k: string) => issues[k];
  const chosen = Object.keys(d.directions).length;

  return (
    <div className="col gap-4">
      {welcome || !complete ? (
        <Card tone="accent">
          <div className="row between">
            <div>
              <div className="strong">{welcome ? m.profile.basics.welcomeTitle : m.profile.basics.incompleteTitle}</div>
              <div className="muted small">{m.profile.basics.welcomeDescription}</div>
            </div>
            {isOwner ? (
              <Button size="sm" variant="ghost" icon={<Upload size={13} />} onClick={() => void importYaml()} loading={importing}>
                {m.profile.basics.importButton}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Section title={m.profile.basics.contactTitle} description={m.profile.basics.contactDescription}>
        <div className="basics-grid">
          <Field label={m.profile.basics.name} htmlFor="b-name" error={err("name")}>
            <Input id="b-name" value={d.name} onChange={(e) => patch({ name: e.target.value })} autoComplete="name" />
          </Field>
          <Field label={m.profile.basics.email} htmlFor="b-email" error={err("email")} hint={m.profile.basics.emailHint}>
            <Input id="b-email" type="email" value={d.email} onChange={(e) => patch({ email: e.target.value })} />
          </Field>
          <Field label={m.profile.basics.phone} htmlFor="b-phone" error={err("phone")} hint={m.profile.basics.phoneHint}>
            <Input id="b-phone" value={d.phone} onChange={(e) => patch({ phone: e.target.value })} autoComplete="tel" />
          </Field>
          <Field label={m.profile.basics.linkedin} htmlFor="b-linkedin" error={err("linkedin")} hint={m.profile.basics.linkedinHint}>
            <Input id="b-linkedin" value={d.linkedin} onChange={(e) => patch({ linkedin: e.target.value })} />
          </Field>
          <Field label={m.profile.basics.github} htmlFor="b-github" error={err("github")} hint={m.profile.basics.githubHint}>
            <Input id="b-github" value={d.github} onChange={(e) => patch({ github: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title={m.profile.basics.educationTitle}>
        <div className="basics-grid">
          <Field label={m.profile.basics.school} htmlFor="b-school" error={err("school")}>
            <Input id="b-school" value={d.school} onChange={(e) => patch({ school: e.target.value })} placeholder="University of Southern California" />
          </Field>
          <Field label={m.profile.basics.degree} htmlFor="b-degree" error={err("degree")}>
            <Input id="b-degree" value={d.degree} onChange={(e) => patch({ degree: e.target.value })} placeholder="M.S. ECE" />
          </Field>
          <Field label={m.profile.basics.gradDate} htmlFor="b-grad" error={err("grad_date")} hint={m.profile.basics.gradDateHint}>
            <Input id="b-grad" value={d.grad_date} onChange={(e) => patch({ grad_date: e.target.value })} placeholder="2027-05" className="mono" />
          </Field>
          <Field label={m.profile.basics.workAuthStatus} htmlFor="b-status" error={err("work_auth.status")} hint={m.profile.basics.workAuthStatusHint}>
            <Input id="b-status" value={d.work_auth.status} onChange={(e) => patch({ work_auth: { ...d.work_auth, status: e.target.value } })} />
          </Field>
          <Field label={m.profile.basics.sponsorship} hint={m.profile.basics.sponsorshipHint}>
            <Checkbox
              label={m.profile.basics.needsSponsorship}
              checked={d.work_auth.needs_sponsorship}
              onChange={(e) => patch({ work_auth: { ...d.work_auth, needs_sponsorship: e.target.checked } })}
            />
          </Field>
        </div>
      </Section>

      <Section title={m.profile.basics.targetsTitle} description={m.profile.basics.targetsDescription}>
        <div className="basics-grid">
          <Field label={m.profile.basics.primaryTarget} htmlFor="b-primary">
            <Select id="b-primary" value={d.targets.primary} onChange={(e) => patch({ targets: { ...d.targets, primary: e.target.value as "newgrad" | "intern" } })}>
              <option value="newgrad">{m.profile.basics.targetNewGrad}</option>
              <option value="intern">{m.profile.basics.targetIntern}</option>
            </Select>
          </Field>
          <Field label={m.profile.basics.secondaryTarget} htmlFor="b-secondary">
            <Select id="b-secondary" value={d.targets.secondary} onChange={(e) => patch({ targets: { ...d.targets, secondary: e.target.value as "newgrad" | "intern" | "" } })}>
              <option value="">{m.profile.basics.targetNone}</option>
              <option value="newgrad">{m.profile.basics.targetNewGrad}</option>
              <option value="intern">{m.profile.basics.targetIntern}</option>
            </Select>
          </Field>
          <Field label={m.profile.basics.dailyBudget} htmlFor="b-budget">
            <Input id="b-budget" type="number" min={10} max={600} value={d.daily_minutes_budget} onChange={(e) => patch({ daily_minutes_budget: Number(e.target.value) || 90 })} />
          </Field>
        </div>
      </Section>

      <Section
        title={m.profile.basics.directionsTitle}
        description={m.profile.basics.directionsDescription}
        actions={<span className={chosen === 0 ? "text-danger small" : "muted small"}>{chosen === 0 ? m.profile.basics.noneChosen : m.profile.basics.chosenCount(chosen)}</span>}
      >
        {err("directions") ? <div className="field-error mb-2">{err("directions")}</div> : null}
        <div className="direction-grid">
          {Object.entries(DIRECTIONS).map(([slug, meta]) => {
            const tier = (d.directions[slug] ?? 0) as Tier;
            return (
              <div key={slug} className={`direction-row${tier ? " is-on" : ""}`} title={meta.blurb}>
                <span className="direction-label truncate">{meta.label}</span>
                <Segmented<`${Tier}`>
                  ariaLabel={m.profile.basics.directionTierAria(meta.label)}
                  size="sm"
                  value={`${tier}` as `${Tier}`}
                  onChange={(v) => setDirection(slug, Number(v) as Tier)}
                  options={([0, 1, 2, 3] as Tier[]).map((t) => ({ value: `${t}` as `${Tier}`, label: TIER_LABEL[t] }))}
                />
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={m.profile.basics.eeoTitle} description={m.profile.basics.eeoDescription}>
        <div className="basics-grid">
          <Field label={m.profile.basics.gender} htmlFor="b-gender">
            <Select id="b-gender" value={d.eeo.gender} onChange={(e) => patch({ eeo: { ...d.eeo, gender: e.target.value } })}>
              {(GENDER.includes(d.eeo.gender) ? GENDER : [d.eeo.gender, ...GENDER]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={m.profile.basics.race} htmlFor="b-race">
            <Select id="b-race" value={d.eeo.race} onChange={(e) => patch({ eeo: { ...d.eeo, race: e.target.value } })}>
              {(RACE.includes(d.eeo.race) ? RACE : [d.eeo.race, ...RACE]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={m.profile.basics.veteran} htmlFor="b-veteran">
            <Select id="b-veteran" value={d.eeo.veteran} onChange={(e) => patch({ eeo: { ...d.eeo, veteran: e.target.value } })}>
              {(VETERAN.includes(d.eeo.veteran) ? VETERAN : [d.eeo.veteran, ...VETERAN]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={m.profile.basics.disability} htmlFor="b-disability">
            <Select id="b-disability" value={d.eeo.disability} onChange={(e) => patch({ eeo: { ...d.eeo, disability: e.target.value } })}>
              {(DISABILITY.includes(d.eeo.disability) ? DISABILITY : [d.eeo.disability, ...DISABILITY]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Section>

      <div className="row">
        <Button variant="primary" icon={<Sparkles size={14} />} onClick={() => void save()} loading={busy} disabled={!dirty && complete}>
          {m.profile.basics.save}
        </Button>
        {dirty ? <span className="muted small">{m.profile.basics.unsaved}</span> : complete ? <span className="text-good small">{m.profile.basics.complete}</span> : null}
      </div>
    </div>
  );
}
