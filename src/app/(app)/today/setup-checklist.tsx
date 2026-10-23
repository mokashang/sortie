"use client";
import { Check } from "lucide-react";
import type { Overview } from "@/app/lib/overview-types";
import { cx } from "@/app/lib/cx";
import { Card, LinkButton } from "@/app/components/ui";
import { useMessages } from "@/i18n/client";

// 今日 → 新手上路 (2026-10-22): what a new account does, in order, before its first application —
// each step with where to do it, ticked from the live overview. The owner's brother signed up,
// saved his basics and was left on an empty page with a 开始投递 button: no resume, two typed-in
// education rows, and no word that jobs were still being scored. Gone once something is submitted.
export function SetupChecklist({ o }: { o: Overview }) {
  const m = useMessages();
  const s = o.setup;
  if (!s) return null;
  const t = m.today.setup;
  const steps: { key: string; title: string; hint: string; done: boolean; href: string | null }[] = [
    { key: "basics", title: t.basics, hint: t.basicsHint, done: o.profileComplete, href: "/profile?tab=basics" },
    { key: "resume", title: t.resume, hint: t.resumeHint, done: s.hasResume, href: "/profile?tab=resumes" },
    { key: "experiences", title: t.experiences, hint: t.experiencesHint, done: s.experiences >= 3, href: "/profile?tab=experiences" },
    {
      key: "scoring",
      title: t.scoring,
      hint: s.scored > 0 ? t.scoringProgress(s.scored) : t.scoringWaiting,
      done: o.counts.queueMatched > 0,
      href: s.scored > 0 ? "/queue" : null,
    },
    { key: "apply", title: t.apply, hint: t.applyHint(o.chromeAvailable), done: s.applyStarted, href: "/apply#plan" },
  ];
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length) return null;
  const next = steps.find((x) => !x.done && x.href)?.key;
  return (
    <Card className="setup-card mb-4">
      <div className="row between">
        <h3>{t.title}</h3>
        <span className="muted small mono">{t.progress(done, steps.length)}</span>
      </div>
      <ol className="setup-steps">
        {steps.map((x, i) => (
          <li key={x.key} className={cx("setup-step", x.done && "is-done", x.key === next && "is-next")}>
            <span className="setup-mark" aria-hidden>
              {x.done ? <Check size={13} /> : i + 1}
            </span>
            <div className="grow">
              <div className="strong">{x.title}</div>
              <div className="muted small">{x.hint}</div>
            </div>
            {x.done ? (
              <span className="muted xs">{t.done}</span>
            ) : x.href ? (
              <LinkButton href={x.href} size="sm" variant={x.key === next ? "primary" : "ghost"}>
                {t.go}
              </LinkButton>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
