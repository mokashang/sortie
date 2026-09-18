// What the in-app 问助手 knows about Sortie itself (spec 2026-09-18 §5). Written from the user's
// side of the screen: pages, flows, cards, task labels and settings — the things a user asks
// "how does this work" about. Internal names (run, executor, user_chrome, headless, pid, slug)
// are deliberately absent; the glossary at the end pins the interface words in both languages so
// an answer uses the same nouns the screen does. Kept in English: the model answers in the UI
// language it is told to use, and translating a fact is cheaper than maintaining two guides.

export const APP_GUIDE = `# Sortie — what the app is and how it works

Sortie is a personal job-search operating system for one person's 2026 US software / hardware
engineering search (new grad and internship roles, F-1 student who needs visa sponsorship). It
finds postings, scores them against the user's profile, and an **assistant** applies to them in
the user's own logged-in Chrome — but every application is submitted only after the user
confirms it in the app, and every message to a person is sent only after the user approves it.

## Pages (top bar on desktop, tab bar on phones)

- **Today** (/) — the inbox: things waiting on the user (fills to confirm, to-do cards, referral
  drafts to approve, referral conversations to decide on), the assistant's status, the day's
  numbers, and the top of the queue for the main track.
- **Jobs** (/queue) — the scored queue, one tab per track (direction), search (?q=), sort, a
  referral / direct filter, per-row menu (pin, change mode, skip — undoable), a detail panel with
  the score reasons, eligibility, referral suggestion and the job description. The last tab "All
  jobs" is the raw library of everything ever ingested.
- **Apply** (/apply) — the assistant card, the "this run's plan" stepper (per track: how many
  to find a referral for, how many to apply to directly), then sub-tabs: **To-do** (cards the
  assistant stopped on), **To confirm** (filled applications waiting for the user), **Referrals in
  progress**, **Submitted today**.
- **History** (/history) — every application by track and date; the user can move a row through
  OA → interview → offer by hand.
- **Network** (/network) — coffee-chat outreach and hidden opportunities (drafts the user approves,
  people found at target companies).
- **Profile** (/profile) — Basics (the profile the assistant fills forms from), Experience
  (editable entries used for resumes and messages), Resume (one generated PDF per track), Standard
  answers (remembered answers to recurring form questions), Files (transcript, portfolio etc. that
  forms may ask for).
- **Stats** (/dashboard) — funnel and weekly numbers.
- **Settings** (/settings) — AI provider, auto-apply, the chat assistant's model, execution mode,
  language, appearance, notifications, a link to the Sources page, and the account section (name,
  email, password, Google link, signed-in devices, assistant tokens, delete account).
- **Sources** (/sources) — a troubleshooting page, not in the navigation: which job boards are
  polled, how often, and errors in the last 24 hours.

## How jobs get into the queue

1. **Sources**: every company careers board is a row (Greenhouse, Lever, Ashby, Workday, iCIMS,
   SmartRecruiters, Oracle, Workable, Amazon, ByteDance/TikTok, LinkedIn guest listings, several
   open-source GitHub lists). A scheduler ticks every minute and polls boards that are due: core
   boards hourly, long-tail daily, dormant weekly, muted never. Boards are promoted or demoted by
   what they produced in the last 90 days. Scanning never notifies.
2. **Chrome scan** (Jobs / Today / Settings → "Scan ▾" → "Scan in my Chrome"): a read-only pass
   over LinkedIn (logged in), Handshake (USC) and Tesla in the user's Chrome; it queues an
   assistant task of kind "scan".
3. **Filters**: only US roles; postings that say no sponsorship, citizens only, clearance, PhD
   only, or that are not engineering roles are archived; duplicates (same company + title across
   boards) are merged into one main row.
4. **Scoring**: the AI scores each job for one of 12 tracks (SWE general, AI infra, ML, GPU/CUDA,
   systems, embedded, robotics, security, quant, data, hardware, etc.), with a time penalty (no
   penalty in the first 14 days, then 1 point per 5 days up to 10). Jobs at big / well-known
   companies scoring ≥75 get a "referral suggested" tag.
5. **Fetch descriptions** (a background task of kind "jd_review"): postings without a description
   are opened in a background browser, read, and re-checked for eligibility; it runs on its own
   after scans, at most 10 rounds a day.

## The assistant and its tasks

"Assistant" is the one name for everything that acts on the user's behalf. A **task #N** is one
unit of work: kinds are apply, check referral replies, scan, fetch descriptions, send outreach,
find people. Two ways to run: **in my Chrome** (default — a session that controls the user's own
logged-in Chrome; a session in the desktop app picks tasks up when it is online, otherwise the
app starts one itself) and **background browser** (a separate browser profile, used for fetching
descriptions and available for applying if chosen in Settings).

Task statuses: Queued (waiting for a session to pick it up), Running, Done, Incomplete, Failed,
Stopped, Paused. **Done vs Incomplete**: a task shows Done only when it met its plan; otherwise it
shows "Incomplete · direct 5/70 · referrals 0/40". The detail dialog breaks the count down into
submitted / to confirm / to-do / archived / nobody to contact. "View steps" opens the task's log,
one line per step (claimed, opened page, eligibility, each field group, upload, read-back,
reported, waiting, submitted, skipped and why).

**Relay**: a big plan is done in segments of 10 (filled applications + referral companies) — each
segment is its own task; when one finishes the app queues the next automatically, first
submitting already-approved applications, then filling new ones. A track that produced nothing in
a segment is dropped from the rest of the plan; two empty segments in a row end the relay. If 10
or more filled applications are waiting unconfirmed, the next segment waits as **Paused** until
the user brings the backlog down to 5 or fewer; starting a new plan replaces a paused relay;
pressing Stop ends the chain. A session may be recycled after 15 idle minutes (nothing running,
queued or waiting), and a session that stops writing steps for 10 minutes is nudged.

**Why a task is idle or Failed**: no session online yet (queued), the user stopped it, the
session's process ended (a deploy restart, a crash) — a failed segment still queues the next one.

## Applying (direct)

Plan on Apply → the assistant takes the next best job for the track → opens the posting in Chrome
and reads the live description → if the page proves the job ineligible (no sponsorship, PhD only,
non-engineering, citizens only) it archives it together with its duplicates and moves on; a dead
link is archived and its board muted; "you already applied" is recorded in History → otherwise
it fills the form from the profile, standard answers, experience highlights and the track's resume
→ reports the fill as a **To confirm** card listing every field it typed (long-form answers are
written only from real experience entries, never invented) → the user presses Confirm and submit
(or Reject with a note that reaches the next fill) → the assistant re-reads the form and submits →
the row appears under Submitted today and in History. A confirmation never expires; if the
session that filled it is gone, a new task re-fills and asks again. Count semantics: a plan's
direct count = applications filled and reported, not submissions.

## To-do cards (Apply → To-do, also on Today)

Whenever the assistant has to stop for the user it leaves a card with a clear action, and moving
the card automatically continues the work — there is no dead end:
- **Needs info** — a form question with no known answer (or a decision only the user can make):
  answer it on the card; answers are remembered as standard answers. "Skip this job" archives it.
- **Upload a file** — the form wants a transcript / portfolio / cover letter: upload once, it is
  kept under Profile → Files for every later form.
- **Sign in once** — a login wall or a "create candidate account" step: the assistant never types
  passwords or creates accounts. The user signs in once in the job-search Chrome and presses
  "I'm signed in"; every paused job on that site re-queues.
- **Do it here** — a captcha or 2-step verification in the tab the assistant left open: do it,
  press Done, the assistant continues.
- **Finish yourself** — something only a person can do (a video, a test format the browser
  can't complete): "I applied myself" records it, or skip.
- **Assistant error** — a tool failure: "Let the assistant try again".
- A rejected fill also becomes a card (the note goes to the next attempt).
Cards from a waiting assistant time out after 30 minutes; the card stays and re-queues once
answered.

## Auto-apply (Settings)

Off (default): every fill waits on a To confirm card. On: the app approves a fill the moment it is
reported, and answers missing text questions itself from the profile, standard answers and
experience (never inventing numbers or facts; visa answered truthfully); only sign-in, account
creation, captcha, missing files and finish-yourself steps still leave a card; every automatic
submission sends a phone notification. Messages to people are never auto-sent.

## Referrals

Tracks can be planned as "find a referral" instead of direct apply. The assistant takes up to 3
jobs at one company, then contacts up to 3 people there in the user's LinkedIn — USC alumni
first, then engineers on the team, then recruiters. It reads each person's profile and the app
drafts the message (a full DM plus a ≤200-character connection note): the message always gives
first (one specific true thing about the person or their team, one concrete thing the user built),
asks small with an easy out, thanks regardless. **The user approves every message** on the card
(or sends it back to draft to edit). Free LinkedIn allows 5 invitations with a note per month
and 200 characters per note; 2nd/3rd-degree "Message" is a paid InMail wall the assistant never
uses. Jobs then sit under **Referrals in progress** per company with each contact's stage
(pending / accepted / replied / asked for resume / will refer / referred / declined / no
headcount); a "check replies" task runs at 9:00 and 18:00 (or from the card) and reads the
conversations. The user decides: "Got a referral" (then the application is filled with the
referral link / code), "Apply directly", or "Cast again" (different people). If nobody at the
company can be contacted, the card says so and the job goes back to direct.

## What the chat itself can do

Besides answering, the chat can (1) look a posting up in the library, (2) start a direct
application to one posting the user names — it queues an "apply" task for that job exactly as the
Jobs page would, the assistant fills it in the user's Chrome, and it ends on a To confirm card
(or is submitted at once when auto-apply is on), after which it shows under Submitted today and in
History — and (3) add a posting the user pastes a link to, then apply to it. A posting that was
archived (no sponsorship, PhD only, low score) or is paused on a to-do card is not applied to
silently: the chat says why and applies only if the user still wants it. It cannot send messages,
plan a batch, approve, stop, or change settings.

## Notifications

Desktop notifications in the browser; phone push through ntfy when configured in Settings. Sent
for: a fill to confirm, a to-do card, a referral draft to approve, an automatic submission.

## Settings that change behaviour

- **AI provider** — Codex (saved ChatGPT login), GPT API (OpenAI key), Claude (the claude CLI
  login). One choice for scoring, dedupe, drafting, resumes, and the browser tasks.
- **Auto-apply** — see above.
- **Chat assistant** — this chat's model: the Claude subscription (default) or the AI provider above.
- **Execution mode** — in my Chrome (default) or background browser.
- **Language** — Chinese / English (also in the top bar). **Appearance** — light / dark / system.

## Answering common questions

- "What is the assistant doing?" → the live task, its latest step, how long ago it started.
- "Why does task #N say Incomplete?" → compare planned vs achieved in the outcome; the breakdown
  and the last log lines say where the rest went (archived, to-do cards, nobody to contact,
  stopped). Suggest View steps for the full log.
- "Nothing is being submitted" → look for unconfirmed fills (they wait for Confirm), a paused
  relay (backlog ≥10), a queued task with no session online, or a sign-in card.
- "Why did a job disappear from the queue?" → archived for eligibility (no sponsorship / PhD only /
  non-engineering / not US), merged as a duplicate, skipped by the user, or taken by a task.
- "How do I …" → name the page, the tab and the button.
`;

// Interface nouns in both languages. The answer must use the words of the language it is written
// in; these pairs keep a Chinese answer from inventing its own translation of "To confirm".
export const UI_GLOSSARY = `Chinese ↔ English interface words:
今日 Today · 职位 Jobs · 投递 Apply · 历史 History · 人脉 Network · 档案 Profile · 统计 Stats ·
设置 Settings · 信息源 Sources · 助手 assistant · 任务 #N task #N · 在我的 Chrome 里 in my Chrome ·
后台浏览器 background browser · 内推 referral · 海投 direct apply · 找内推 find a referral ·
建议内推 referral suggested · 有内推了 Got a referral · 直接投 Apply directly · 再撒网 Cast again ·
待确认 To confirm · 确认提交 Confirm and submit · 拒绝 Reject · 待处理 To-do · 补信息 Needs info ·
传文件 Upload a file · 登录一次 Sign in once · 我登好了 I'm signed in · 现场完成 Do it here ·
亲自完成 Finish yourself · 我自己投完了 I applied myself · 让助手再试一次 Let the assistant try again ·
跳过这个岗 Skip this job · 今日已提交 Submitted today · 内推进行中 Referrals in progress ·
检查回复 check replies · 方向 track · 梯队 tier · 队列 queue · 全部入库 All jobs · 置顶 pin ·
跳过 skip · 归档 archive · 撤销 undo · 补正文 fetch descriptions · 打分 score · 补判 re-check ·
校友 alum · 招聘方 recruiter · 用人经理 hiring manager · 工程师 engineer · coffee chat coffee chat ·
经历 experience · 简历 resume · 标准答案 standard answers · 文件 Files · 板块 board ·
核心 / 长尾 / 休眠 / 静音 core / longtail / dormant / muted · 签证 sponsorship · 仅限博士 PhD only ·
排队中 Queued · 进行中 Running · 已完成 Done · 未完成 Incomplete · 失败 Failed · 已停止 Stopped ·
已暂停 Paused · 接力 relay · 本段 this segment · 自动投递 Auto-apply · AI 提供方 AI provider ·
问助手 Ask the assistant · 查看步骤 View steps · 本次投递计划 this run's plan · 开始投递 Start applying ·
停止 Stop · 扫描 Scan · 在我的 Chrome 里扫描 Scan in my Chrome · 通知 notifications.`;
