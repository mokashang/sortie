"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Upload } from "lucide-react";
import { DIRECTIONS } from "@/matcher/directions";
import { putJson, postJson, errorMessage, ApiError } from "@/app/lib/api";
import { Button, Card, Checkbox, Field, Input, Section, Segmented, Select, useToast } from "@/app/components/ui";

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
const TIER_LABEL: Record<Tier, string> = { 0: "不投", 1: "最想去", 2: "想去", 3: "可以" };

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
      toast({ title: "基本信息已保存", description: "助手会用这些信息打分和填表。", tone: "good" });
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
        toast({ title: "还有几项没填对", description: "看红字提示。", tone: "warn" });
      } else {
        toast({ title: "保存失败", description: errorMessage(e), tone: "danger" });
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
      toast({ title: "已从 profile.yaml 导入", tone: "good" });
      router.refresh();
    } catch (e) {
      toast({ title: "导入失败", description: errorMessage(e), tone: "danger" });
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
              <div className="strong">{welcome ? "欢迎!先花两分钟填好基本信息" : "基本信息还没填完"}</div>
              <div className="muted small">助手要靠这些字段给职位打分、生成简历、填网申表单。带 * 的是必填。</div>
            </div>
            {isOwner ? (
              <Button size="sm" variant="ghost" icon={<Upload size={13} />} onClick={() => void importYaml()} loading={importing}>
                从服务器的 profile.yaml 导入
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Section title="联系方式" description="投递表单里的联系信息,和简历页眉一致。">
        <div className="basics-grid">
          <Field label="姓名 *" htmlFor="b-name" error={err("name")}>
            <Input id="b-name" value={d.name} onChange={(e) => patch({ name: e.target.value })} autoComplete="name" />
          </Field>
          <Field label="邮箱 *" htmlFor="b-email" error={err("email")} hint="网申用的邮箱,可以和登录邮箱不同。">
            <Input id="b-email" type="email" value={d.email} onChange={(e) => patch({ email: e.target.value })} />
          </Field>
          <Field label="电话 *" htmlFor="b-phone" error={err("phone")} hint="如 +1-323-000-0000">
            <Input id="b-phone" value={d.phone} onChange={(e) => patch({ phone: e.target.value })} autoComplete="tel" />
          </Field>
          <Field label="LinkedIn" htmlFor="b-linkedin" error={err("linkedin")} hint="如 linkedin.com/in/your-name">
            <Input id="b-linkedin" value={d.linkedin} onChange={(e) => patch({ linkedin: e.target.value })} />
          </Field>
          <Field label="GitHub" htmlFor="b-github" error={err("github")} hint="如 github.com/your-name">
            <Input id="b-github" value={d.github} onChange={(e) => patch({ github: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section title="教育与身份">
        <div className="basics-grid">
          <Field label="学校 *" htmlFor="b-school" error={err("school")}>
            <Input id="b-school" value={d.school} onChange={(e) => patch({ school: e.target.value })} placeholder="University of Southern California" />
          </Field>
          <Field label="学位 *" htmlFor="b-degree" error={err("degree")}>
            <Input id="b-degree" value={d.degree} onChange={(e) => patch({ degree: e.target.value })} placeholder="M.S. ECE" />
          </Field>
          <Field label="毕业年月 *" htmlFor="b-grad" error={err("grad_date")} hint="YYYY-MM,如 2027-05">
            <Input id="b-grad" value={d.grad_date} onChange={(e) => patch({ grad_date: e.target.value })} placeholder="2027-05" className="mono" />
          </Field>
          <Field label="工作身份 *" htmlFor="b-status" error={err("work_auth.status")} hint="如 F-1 / OPT / H-1B / citizen">
            <Input id="b-status" value={d.work_auth.status} onChange={(e) => patch({ work_auth: { ...d.work_auth, status: e.target.value } })} />
          </Field>
          <Field label="签证" hint="如实填写:需要 sponsorship 时,助手在表单里也会如实回答。">
            <Checkbox
              label="将来需要公司 sponsor 工作签证"
              checked={d.work_auth.needs_sponsorship}
              onChange={(e) => patch({ work_auth: { ...d.work_auth, needs_sponsorship: e.target.checked } })}
            />
          </Field>
        </div>
      </Section>

      <Section title="目标岗位" description="主要找哪类岗位;每天愿意花多少分钟在投递上。">
        <div className="basics-grid">
          <Field label="主要目标 *" htmlFor="b-primary">
            <Select id="b-primary" value={d.targets.primary} onChange={(e) => patch({ targets: { ...d.targets, primary: e.target.value as "newgrad" | "intern" } })}>
              <option value="newgrad">New Grad 全职</option>
              <option value="intern">实习</option>
            </Select>
          </Field>
          <Field label="次要目标" htmlFor="b-secondary">
            <Select id="b-secondary" value={d.targets.secondary} onChange={(e) => patch({ targets: { ...d.targets, secondary: e.target.value as "newgrad" | "intern" | "" } })}>
              <option value="">无</option>
              <option value="newgrad">New Grad 全职</option>
              <option value="intern">实习</option>
            </Select>
          </Field>
          <Field label="每天投递预算(分钟)" htmlFor="b-budget">
            <Input id="b-budget" type="number" min={10} max={600} value={d.daily_minutes_budget} onChange={(e) => patch({ daily_minutes_budget: Number(e.target.value) || 90 })} />
          </Field>
        </div>
      </Section>

      <Section
        title="方向与梯队 *"
        description="至少选一个方向。梯队决定队列里的优先级:1 = 最想去,排在最前。"
        actions={<span className={chosen === 0 ? "text-danger small" : "muted small"}>{chosen === 0 ? "还没选方向" : `已选 ${chosen} 个方向`}</span>}
      >
        {err("directions") ? <div className="field-error mb-2">{err("directions")}</div> : null}
        <div className="direction-grid">
          {Object.entries(DIRECTIONS).map(([slug, meta]) => {
            const tier = (d.directions[slug] ?? 0) as Tier;
            return (
              <div key={slug} className={`direction-row${tier ? " is-on" : ""}`} title={meta.blurb}>
                <span className="direction-label truncate">{meta.label}</span>
                <Segmented<`${Tier}`>
                  ariaLabel={`${meta.label} 梯队`}
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

      <Section title="EEO 自愿申报" description="网申的自愿申报题按这里填。如实填写或选「不愿回答」;不影响匹配。">
        <div className="basics-grid">
          <Field label="性别" htmlFor="b-gender">
            <Select id="b-gender" value={d.eeo.gender} onChange={(e) => patch({ eeo: { ...d.eeo, gender: e.target.value } })}>
              {(GENDER.includes(d.eeo.gender) ? GENDER : [d.eeo.gender, ...GENDER]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="族裔" htmlFor="b-race">
            <Select id="b-race" value={d.eeo.race} onChange={(e) => patch({ eeo: { ...d.eeo, race: e.target.value } })}>
              {(RACE.includes(d.eeo.race) ? RACE : [d.eeo.race, ...RACE]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="退伍军人身份" htmlFor="b-veteran">
            <Select id="b-veteran" value={d.eeo.veteran} onChange={(e) => patch({ eeo: { ...d.eeo, veteran: e.target.value } })}>
              {(VETERAN.includes(d.eeo.veteran) ? VETERAN : [d.eeo.veteran, ...VETERAN]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="残障状况" htmlFor="b-disability">
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
          保存基本信息
        </Button>
        {dirty ? <span className="muted small">有未保存的修改。</span> : complete ? <span className="text-good small">已完整,助手可以工作了。</span> : null}
      </div>
    </div>
  );
}
