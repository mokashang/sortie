import { DB, logEvent } from "@/lib/db";
import { InfoQuestion, infoKind, manualItem, MULTI_ANSWER_SEP } from "@/apply/queue";

// The 待处理 list (spec 2026-09-13-todo-list-design): everything the assistant stopped on that
// only the user can move. Each application carries its to-do items on pending_questions
// (InfoQuestion[], see queue.ts for the kinds) and is in one of two states:
//   needs_info — the assistant is still on the form, polling confirmStatus (text / file / action
//                items): answering here moves the row to 'prepared' and it continues right there;
//   matched + needs_manual_reason — paused; the assistant moved on (login / manual items, or a
//                waiting item that timed out): answering / 我登好了 / 让助手再试一次 clears the row
//                and the API layer re-queues it as a targeted run (maybeAutoStartApply).
// Text answers can be remembered into profile.standard_answers so the same question is never
// asked twice; file answers are paths into data/documents (already standing assets) and action
// / login / manual items are never answers at all.

export interface InfoAnswer {
  value: string;
  remember?: boolean; // default true — persist to profile.standard_answers under the question key (text items only)
}

export interface PendingInfoRow {
  jobId: number;
  company: string;
  title: string;
  applyUrl: string | null;
  direction: string | null;
  status: string; // 'needs_info' (assistant waiting on the form) | 'matched' (paused; the assistant moved on)
  needsManualReason: string | null;
  questions: InfoQuestion[];
  askedAt: string; // local "MM-DD HH:MM"
}

interface PendingInfoRaw {
  job_id: number;
  company: string;
  title: string;
  apply_url: string | null;
  direction: string | null;
  status: string;
  needs_manual_reason: string | null;
  pending_questions: string | null;
  asked_at: string;
}

// The cards' data source. A paused row that somehow carries only a reason (an old-protocol
// report, a row from before this design) is shown too, as a single manual item built from the
// reason — nothing paused is ever invisible.
export function pendingInfo(db: DB, userId: string): PendingInfoRow[] {
  const rows = db
    .prepare(
      `SELECT a.job_id, j.company, j.title, j.apply_url, m.direction, a.status, a.needs_manual_reason,
              a.pending_questions, strftime('%m-%d %H:%M', a.updated_at, 'localtime') as asked_at
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       LEFT JOIN matches m ON m.job_id = j.id AND m.user_id = a.user_id
       WHERE a.user_id = ? AND ((a.status = 'needs_info' AND a.pending_questions IS NOT NULL)
          OR (a.status = 'matched' AND a.needs_manual_reason IS NOT NULL))
       ORDER BY (a.status = 'needs_info') DESC, a.updated_at DESC`
    )
    .all(userId) as PendingInfoRaw[];
  return rows.map((r) => {
    let questions: InfoQuestion[] = [];
    if (r.pending_questions) {
      try {
        const parsed = JSON.parse(r.pending_questions);
        if (Array.isArray(parsed)) questions = parsed.filter((q) => q && typeof q.key === "string" && typeof q.label === "string");
      } catch {
        questions = [];
      }
    }
    if (questions.length === 0) {
      questions = [manualItem("manual", "助手没能完成这份申请", r.needs_manual_reason ?? undefined)];
    }
    return {
      jobId: r.job_id,
      company: r.company,
      title: r.title,
      applyUrl: r.apply_url,
      direction: r.direction,
      status: r.status,
      needsManualReason: r.needs_manual_reason,
      questions,
      askedAt: r.asked_at,
    };
  });
}

export interface AnswerInfoResult {
  remembered: Record<string, string>; // what got persisted to profile.standard_answers
  status: string; // the application's status after answering: 'prepared' (assistant continues) | 'matched' (re-queue)
}

// User -> App from a 待处理 card's form. Stores the answers on the application (all of them, so
// the executor / a later re-take sees the full set), hands the remembered text answers to
// `persist` (the profile writer, injected so tests don't touch profile.yaml), and moves the
// application on: needs_info -> prepared (the waiting executor's next poll picks the answers up
// and continues); paused -> matched with the reason and items cleared (the caller re-queues it).
// Every required text / file / action item must be answered — a half-answered form would just
// bounce back. login / manual items are not answers and are ignored here (they're resolved by
// resolveLogin / unpark / archiveManual).
export interface AnswerInfoOpts {
  // false = no apply run is on the form any more (it failed, was stopped or reaped), so a
  // 'needs_info' row must not be handed back to a dead executor: it is re-queued like a paused
  // row instead. Default true (the executor is still polling and continues on 'prepared').
  executorWaiting?: boolean;
}

export function answerInfo(
  db: DB,
  userId: string,
  jobId: number,
  answers: Record<string, InfoAnswer>,
  persist: (remembered: Record<string, string>) => void,
  opts: AnswerInfoOpts = {}
): AnswerInfoResult {
  const row = db
    .prepare("SELECT status, pending_questions, info_answers, needs_manual_reason FROM applications WHERE user_id = ? AND job_id = ?")
    .get(userId, jobId) as
    | { status: string; pending_questions: string | null; info_answers: string | null; needs_manual_reason: string | null }
    | undefined;
  if (!row) throw new Error(`answerInfo: no application for job ${jobId}`);
  if (!row.pending_questions) throw new Error(`answerInfo: job ${jobId} has no pending questions`);
  if (row.status !== "needs_info" && row.status !== "matched") {
    throw new Error(`answerInfo: cannot answer from status '${row.status}' (must be 'needs_info' or 'matched')`);
  }
  let questions: InfoQuestion[] = [];
  try {
    questions = JSON.parse(row.pending_questions);
  } catch {
    throw new Error(`answerInfo: job ${jobId} has corrupt pending_questions`);
  }

  const all: Record<string, string> = {};
  const remembered: Record<string, string> = {};
  for (const q of questions) {
    const kind = infoKind(q);
    if (kind === "login" || kind === "manual") continue;
    const a = answers[q.key];
    let value = typeof a?.value === "string" ? a.value.trim() : "";
    if (!value) {
      if (q.optional) continue; // left blank on purpose — the executor skips this field
      throw new Error(`answerInfo: missing answer for '${q.key}'`);
    }
    if (kind === "text" && q.options && q.options.length > 0) {
      if (q.multiple) {
        const parts = value.split(MULTI_ANSWER_SEP).map((p) => p.trim()).filter(Boolean);
        for (const p of parts) {
          if (!q.options.includes(p)) throw new Error(`answerInfo: '${p}' is not one of the options for '${q.key}'`);
        }
        if (parts.length === 0) throw new Error(`answerInfo: missing answer for '${q.key}'`);
        value = parts.join(MULTI_ANSWER_SEP);
      } else if (!q.options.includes(value)) {
        throw new Error(`answerInfo: '${value}' is not one of the options for '${q.key}'`);
      }
    }
    all[q.key] = value;
    // Only text answers are candidates for the profile: a file answer is a path into
    // data/documents (already a standing asset) and an action answer is just "done".
    if (kind === "text" && a.remember !== false) remembered[q.key] = value;
  }

  let existing: Record<string, string> = {};
  try {
    existing = row.info_answers ? JSON.parse(row.info_answers) : {};
  } catch {
    existing = {};
  }
  const merged = { ...existing, ...all };

  if (Object.keys(remembered).length > 0) persist(remembered);

  const nextStatus = row.status === "needs_info" && opts.executorWaiting !== false ? "prepared" : "matched";
  db.prepare(
    "UPDATE applications SET status = ?, info_answers = ?, pending_questions = NULL, needs_manual_reason = NULL WHERE user_id = ? AND job_id = ?"
  ).run(nextStatus, JSON.stringify(merged), userId, jobId);
  logEvent(db, "application_info_answered", {
    userId,
    entity: "application",
    entityId: jobId,
    payload: { keys: Object.keys(all), remembered: Object.keys(remembered), from: row.status, to: nextStatus },
  });
  return { remembered, status: nextStatus };
}

export interface ResolveLoginResult {
  jobIds: number[]; // applications fully cleared (no other item left) — the caller re-queues them
  touched: number; // paused rows that carried a login item for this host
}

// User -> App: 「我登好了」 on a 登录一次 card. The user signed in / registered on `host` in
// their own Chrome, so every paused application whose login item points at that host can go
// again: the item is removed, rows with nothing else left are cleared (reason + items) for the
// caller to re-queue, rows that still carry other items keep waiting on those.
export function resolveLogin(db: DB, userId: string, host: string): ResolveLoginResult {
  const h = host.trim().toLowerCase();
  if (!h) throw new Error("resolveLogin: host is required");
  const rows = db
    .prepare(
      `SELECT job_id, pending_questions FROM applications
       WHERE user_id = ? AND status = 'matched' AND needs_manual_reason IS NOT NULL AND pending_questions LIKE '%"login"%'`
    )
    .all(userId) as { job_id: number; pending_questions: string }[];
  const cleared: number[] = [];
  let touched = 0;
  db.transaction(() => {
    for (const r of rows) {
      let items: InfoQuestion[] = [];
      try {
        items = JSON.parse(r.pending_questions);
      } catch {
        continue;
      }
      const remaining = items.filter((q) => !(infoKind(q) === "login" && (q.host ?? "").toLowerCase() === h));
      if (remaining.length === items.length) continue;
      touched++;
      if (remaining.length === 0) {
        db.prepare("UPDATE applications SET needs_manual_reason = NULL, pending_questions = NULL WHERE user_id = ? AND job_id = ?").run(userId, r.job_id);
        cleared.push(r.job_id);
      } else {
        db.prepare("UPDATE applications SET needs_manual_reason = ?, pending_questions = ? WHERE user_id = ? AND job_id = ?").run(
          remaining.map((q) => q.label).join(" / "),
          JSON.stringify(remaining),
          userId,
          r.job_id
        );
      }
    }
  })();
  logEvent(db, "application_login_done", { userId, payload: { host: h, jobIds: cleared, touched } });
  return { jobIds: cleared, touched };
}

// The notification the App pushes when the executor reports to-do items — one line the user can
// act on from the lock screen: which company, what kind of thing, where to go.
export function needsInfoNotification(company: string, title: string, questions: InfoQuestion[]): { title: string; body: string } {
  const kinds = new Set(questions.map(infoKind));
  const labels = questions.map((q) => q.label).join(" / ");
  const where = "打开 App 投递页「待处理」";
  if (kinds.has("login")) {
    return { title: `Sortie · ${company} 需要你登录一次`, body: `${title}:${labels.slice(0, 160)} — ${where},登完点「我登好了」,助手接着投。` };
  }
  if (kinds.has("manual")) {
    return { title: `Sortie · ${company} 需要你亲自处理`, body: `${title}:${labels.slice(0, 160)} — ${where}。` };
  }
  if (kinds.has("file")) {
    return { title: `Sortie · ${company} 需要你上传文件`, body: `${title}:${labels.slice(0, 160)} — ${where}上传,助手会接着投。` };
  }
  if (kinds.has("action")) {
    return { title: `Sortie · ${company} 需要你在标签页里操作一下`, body: `${title}:${labels.slice(0, 160)} — 做完后${where}点「完成了」。` };
  }
  return {
    title: `Sortie · ${company} 需要你补 ${questions.length} 项信息`,
    body: `${title}:${labels.slice(0, 160)} — ${where}填写,助手会接着投。`,
  };
}
