import type { DB } from "@/lib/db";
import type { Lang } from "@/i18n/lang";
import { messages } from "@/i18n/messages";
import { executorStatus, getRun, runLogLines, type RunStatusRow } from "@/executor/runner";
import { overview } from "@/apply/overview";
import { pendingConfirmations, queueByDirection } from "@/apply/queue";
import { pendingInfo } from "@/apply/info";
import { referralBoard } from "@/apply/referral";
import { todaySubmitted } from "@/apply/history";
import { sourcesSummary } from "@/scanner/sources-view";
import { getAiProvider } from "@/ai/config";
import { getAutoSubmit } from "@/apply/auto-submit";
import { getUser } from "@/lib/users";
import { tryLoadProfile } from "@/lib/profile";
import { directionLabel } from "@/matcher/directions";
import { describeRun } from "@/app/lib/describe-run";
import { runStatusDisplay, runProgressText, runBreakdownText } from "@/app/lib/run-outcome";
import { directionName, labelOf } from "@/app/lib/labels";
import { localFull } from "@/app/lib/time";

// The snapshot the 问助手 chat answers from (spec 2026-09-18 §4): one plain-text picture of the
// account right now, composed only from the read functions the pages already use, so the model
// sees exactly what the screen shows — nothing it could not verify by opening the app. Every
// section is capped so the whole thing stays a few thousand tokens; the last-ten task list is
// always present, and any task the question names by number (#118, 任务 118, task 118) is added
// with its own log so "why did #118 stop" can be answered from the actual steps.

const LIST_CAP = 20;
const LOG_TAIL_LIVE = 20;
const LOG_TAIL_NAMED = 120;
const LINE_MAX = 240;
const SUMMARY_MAX = 400;
const NAMED_CAP = 3;

export interface SnapshotDeps {
  now?: () => number;
}

// Task numbers a question refers to: "#118", "任务 118", "任务#118", "task 118", "run 118".
export function mentionedRunIds(text: string): number[] {
  const out: number[] = [];
  const re = /(?:#|任务\s*#?|task\s*#?|run\s*#?)\s*(\d{1,7})\b/giu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = Number(m[1]);
    if (id > 0 && !out.includes(id)) out.push(id);
    if (out.length >= NAMED_CAP) break;
  }
  return out;
}

function clip(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function bullet(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
}

function runLine(r: RunStatusRow, lang: Lang): string {
  const t = messages[lang];
  const kind = labelOf(t.labels.runKind, r.kind, r.kind);
  const status = runStatusDisplay(r.status, r.outcome, lang).label;
  const channel = labelOf(t.labels.channel, r.channel, r.channel);
  const parts = [`task #${r.id}`, kind, status, channel];
  const what = describeRun(r.kind, r.options, lang);
  if (what) parts.push(what);
  const progress = runProgressText(r.outcome, lang);
  if (progress) parts.push(progress);
  const breakdown = runBreakdownText(r.outcome, lang);
  if (breakdown) parts.push(breakdown);
  parts.push(`started ${localFull(r.startedAt)}`);
  if (r.endedAt) parts.push(`ended ${localFull(r.endedAt)}`);
  if (r.summary) parts.push(`summary: ${clip(r.summary, SUMMARY_MAX)}`);
  return parts.join(" · ");
}

function logBlock(title: string, lines: string[]): string {
  if (lines.length === 0) return `${title}: (no log lines)`;
  return `${title}:\n${lines.map((l) => `  ${clip(l, LINE_MAX)}`).join("\n")}`;
}

export function buildSnapshot(db: DB, userId: string, lang: Lang, question: string, deps: SnapshotDeps = {}): string {
  const now = deps.now ?? (() => Date.now());
  const t = messages[lang];
  const sections: string[] = [];

  // Account & settings
  const user = getUser(db, userId);
  const ov = overview(db, userId);
  const provider = getAiProvider(db);
  const autoSubmit = getAutoSubmit(db, userId);
  sections.push(
    [
      "## Account and settings",
      bullet([
        `user: ${user?.name || user?.email || userId}`,
        `today: ${ov.today} (local time now ${localFull(new Date(now()).toISOString())})`,
        `interface language: ${lang === "zh" ? "Chinese" : "English"}`,
        `AI provider: ${provider}`,
        `auto-apply: ${autoSubmit ? "on" : "off"}`,
        `profile complete: ${ov.profileComplete ? "yes" : "no (the assistant cannot score or apply until Profile → Basics is complete)"}`,
      ]),
    ].join("\n")
  );

  // Profile facts the chat judges postings against (read_posting → fit). Never the contact details.
  const profile = tryLoadProfile(db, userId);
  if (profile) {
    const tier1 = Object.entries(profile.directions)
      .filter(([, t]) => t === 1)
      .map(([slug]) => directionLabel(slug));
    sections.push(
      [
        "## Profile facts (for judging whether a posting fits)",
        bullet([
          `school and degree: ${profile.school}, ${profile.degree}`,
          `graduation (degree conferral): ${profile.grad_date}`,
          `work authorization: ${profile.work_auth.status}; needs visa sponsorship: ${profile.work_auth.needs_sponsorship ? "yes" : "no"}`,
          `targets: ${profile.targets.primary}${profile.targets.secondary ? ` (also ${profile.targets.secondary})` : ""} · US roles only`,
          `top tracks: ${tier1.join(", ") || "(none marked tier 1)"}`,
        ]),
      ].join("\n")
    );
  }

  // Numbers
  const c = ov.counts;
  sections.push(
    [
      "## Numbers",
      bullet([
        `to confirm: ${c.awaitingConfirm} (of which approved and waiting for the assistant to submit: ${c.approvedWaiting})`,
        `to-do cards: ${c.needsInfo}`,
        `referral drafts awaiting approval: ${c.referralDrafts}`,
        `referral conversations needing a decision: ${c.referralProgress}`,
        `jobs in referrals in progress: ${c.referralInFlight}`,
        `network drafts: ${c.networkDrafts} · network approved and waiting to send: ${c.networkPendingSend}`,
        `queue (ready to apply, all tracks): ${c.queueMatched}`,
        `submitted today: ${c.submittedToday} · submitted this week: ${c.submittedThisWeek}`,
      ]),
    ].join("\n")
  );

  // Tasks
  const runs = executorStatus(db, userId);
  const live = runs.filter((r) => r.status === "running" || r.status === "queued" || r.status === "paused");
  const taskLines: string[] = [];
  if (runs.length === 0) taskLines.push("no tasks have run yet");
  for (const r of runs) taskLines.push(runLine(r, lang));
  const liveLogs = live
    .filter((r) => r.status !== "paused")
    .map((r) => logBlock(`latest steps of task #${r.id}`, (r.logTail ?? []).slice(-LOG_TAIL_LIVE)));
  sections.push(["## Tasks (last 10, newest first)", bullet(taskLines), ...liveLogs].join("\n"));

  // "The last apply task" is the most common question, and background fetch-description rounds
  // can push it out of the last ten: add the newest task of each user-facing kind that is missing.
  const older: string[] = [];
  for (const kind of ["apply", "referral_check", "scan"]) {
    if (runs.some((r) => r.kind === kind)) continue;
    const row = db.prepare("SELECT id FROM executor_runs WHERE user_id = ? AND kind = ? ORDER BY id DESC LIMIT 1").get(userId, kind) as { id: number } | undefined;
    const r = row ? getRun(db, userId, row.id) : null;
    if (r) older.push(runLine(r, lang));
  }
  if (older.length > 0) sections.push(["## Latest task of each kind not in the list above", bullet(older)].join("\n"));

  // Named tasks
  const named = mentionedRunIds(question).filter((id) => !live.some((r) => r.id === id));
  const namedBlocks: string[] = [];
  for (const id of named) {
    const r = runs.find((x) => x.id === id) ?? getRun(db, userId, id);
    if (!r) {
      namedBlocks.push(`task #${id}: not found in this account`);
      continue;
    }
    let lines: string[] = [];
    try {
      lines = runLogLines(db, userId, id);
    } catch {
      lines = [];
    }
    const total = lines.length;
    const tail = lines.slice(-LOG_TAIL_NAMED);
    namedBlocks.push(
      [
        runLine(r, lang),
        logBlock(total > tail.length ? `log of task #${id} (last ${tail.length} of ${total} lines)` : `log of task #${id} (${total} lines)`, tail),
      ].join("\n")
    );
  }
  if (namedBlocks.length > 0) sections.push(["## Tasks the question names", ...namedBlocks].join("\n"));

  // To confirm
  const pend = pendingConfirmations(db, userId);
  sections.push(
    [
      `## To confirm (${pend.length})`,
      pend.length === 0
        ? "(none)"
        : bullet(
            pend
              .slice(0, LIST_CAP)
              .map(
                (p) =>
                  `${p.company} — ${p.title} (job #${p.jobId}, ${directionName(p.direction, lang)}${p.score != null ? `, score ${p.score}` : ""})` +
                  `${p.decision === "approved" ? " · approved, waiting for the assistant to submit" : p.decision === "rejected" ? " · rejected" : " · waiting for the user"}` +
                  `${p.referralPersonName ? ` · with referral from ${p.referralPersonName}` : ""}` +
                  `${p.resumeVersion ? ` · resume ${p.resumeVersion}` : ""}`
              )
          ),
    ].join("\n")
  );

  // To-do cards
  const todo = pendingInfo(db, userId, lang);
  sections.push(
    [
      `## To-do cards (${todo.length})`,
      todo.length === 0
        ? "(none)"
        : bullet(
            todo.slice(0, LIST_CAP).map((row) => {
              const state = row.status === "needs_info" ? "assistant waiting on the form" : "paused, assistant moved on";
              const items = row.questions
                .map((q) => `${q.kind ?? "text"}: ${clip(q.label, 120)}${q.hint ? ` (${clip(q.hint, 120)})` : ""}`)
                .join("; ");
              return `${row.company} — ${row.title} (job #${row.jobId}) · ${state} · asked ${row.askedAt} · items: ${items || clip(row.needsManualReason, 200) || "(none)"}`;
            })
          ),
    ].join("\n")
  );

  // Referrals in progress
  const cards = referralBoard(db, userId, now);
  sections.push(
    [
      `## Referrals in progress (${cards.length} companies)`,
      cards.length === 0
        ? "(none)"
        : bullet(
            cards.slice(0, LIST_CAP).map((card) => {
              const jobs = card.jobs.map((j) => `${j.title} (job #${j.jobId}, ${j.status === "referral_ready" ? "got a referral" : "seeking"})`).join("; ");
              const people = card.outreaches
                .map((o) => {
                  // Stage keys (pending / accepted / replied / asked_resume / will_refer / referred /
                  // declined / no_headcount) read fine as they are; the message status stands in
                  // before the first check (draft / pending_send / sent).
                  const stage = o.stage ?? o.status;
                  return `${o.personName} (${o.relation ?? "contact"}, ${stage}${o.stageSummary ? `: ${clip(o.stageSummary, 100)}` : ""})`;
                })
                .join("; ");
              return `${card.company} · jobs: ${jobs} · people: ${people || "(none yet)"}${card.daysWaiting != null ? ` · waiting ${card.daysWaiting} days${card.overdue ? " (overdue)" : ""}` : ""}`;
            })
          ),
    ].join("\n")
  );

  // Submitted today
  const today = todaySubmitted(db, userId);
  sections.push(
    [
      `## Submitted today (${today.length})`,
      today.length === 0
        ? "(none)"
        : bullet(
            today
              .slice(0, LIST_CAP)
              .map((s) => `${s.submittedAt} ${s.company} — ${s.title} (${directionName(s.direction, lang)}, ${s.applyMode}${s.referralPersonName ? `, referral from ${s.referralPersonName}` : ""})`)
          ),
    ].join("\n")
  );

  // Queue by track
  const groups = queueByDirection(db, userId);
  sections.push(
    [
      "## Queue by track (ready to apply)",
      groups.length === 0
        ? "(empty)"
        : bullet(
            groups.map(
              (g) =>
                `${directionName(g.direction, lang)}: ${g.matched} jobs (referral suggested ${g.referralSuggested}, direct ${g.directSuggested})` +
                (g.top.length > 0 ? ` · top: ${g.top.slice(0, 3).map((r) => `${r.company} ${r.title} (${r.score})`).join("; ")}` : "")
            )
          ),
    ].join("\n")
  );

  // Sources
  let tick: string = "(no scan has run yet)";
  try {
    const last = sourcesSummary(db).lastTick;
    if (last) {
      const p = (last.payload ?? {}) as { boards?: number; inserted?: number; errors?: unknown[] };
      tick = `last scan tick ${localFull(last.at)} · boards polled ${p.boards ?? 0} · new jobs ${p.inserted ?? 0} · errors ${Array.isArray(p.errors) ? p.errors.length : 0}`;
    }
  } catch {
    tick = "(unavailable)";
  }
  sections.push(["## Sources", bullet([tick])].join("\n"));

  return sections.join("\n\n");
}
