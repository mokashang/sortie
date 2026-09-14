-- 租户约定(spec 2026-09-13 accounts §3):jobs / boards / companies 是公共数据;带 user_id 的表是每个账号自己的。
-- user_id 的 DEFAULT 'legacy' 只服务迁移(迁移前的数据落在 legacy 桶,由第一个账号认领)和测试造数据:
-- 应用代码必须显式写 user_id(tests/tenancy-guard.test.ts 静态检查)。每张表以 `);` 单独一行收尾——
-- db.ts 的表重建迁移靠这个约定从本文件里截取单张表的 DDL。

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  jd_text TEXT,
  apply_url TEXT,
  source TEXT NOT NULL,            -- github_list | greenhouse | lever | ashby | linkedin | handshake | manual
  ats TEXT,                        -- greenhouse | lever | ashby | workday | other
  posted_at TEXT,
  job_kind TEXT NOT NULL DEFAULT 'newgrad',  -- newgrad | intern
  visa_flag TEXT,                  -- NULL | no_sponsor | citizen_only | clearance
  loc_flag TEXT,                   -- NULL | non_us
  dedup_key TEXT,                  -- norm(company)|norm(title),同岗多 base 共享;consolidate 分组键
  duplicate_of INTEGER REFERENCES jobs(id),  -- 非主行指向主行
  dedup_judged_at TEXT,            -- consolidate 判过的时间;组内任一行为空 ⇒ 待判
  sponsorship TEXT,                -- NULL | yes | no | unknown
  degree_req TEXT,                 -- NULL | ms_ok | phd_only
  role_kind TEXT,                  -- NULL | eng | non_tech
  elig_source TEXT,                -- NULL | match_llm | jd_review | executor_live
  jd_status TEXT,                  -- NULL(ATS 自带正文) | missing | reviewed | login_wall | unreachable | closed
  board_key TEXT,                  -- 所属轮询板块 family:ident(由 apply_url 解析,所有来源都算)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 每个账号对每个岗位的打分(一人一行;打分依赖各自的档案)。
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  direction TEXT,
  score INTEGER,
  tier INTEGER,
  resume_id INTEGER REFERENCES resumes(id),
  reason TEXT,
  skip_reason TEXT,
  referral_fit INTEGER,            -- NULL=unclassified | 1=suggest referral | 0=suggest direct (Claude, src/matcher/referral-fit.ts)
  referral_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, job_id)
);

-- 每个账号对每个岗位一行(注册时回填全部岗位、入库时给每个账号各插一行),状态机见 src/apply/queue.ts。
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  status TEXT NOT NULL DEFAULT 'discovered',
  -- discovered|matched|prepared|needs_info|awaiting_confirm|submitted|oa|interview|offer|offer_accepted|offer_declined|rejected|stale|archived
  -- |referral_seeking (taken by a referral batch, waiting on outreach) |referral_ready (referral obtained, to apply)
  submitted_at TEXT,
  resume_id INTEGER REFERENCES resumes(id),
  form_screenshot TEXT,
  confirm_screenshot TEXT,
  referral_person_id INTEGER REFERENCES people(id),
  origin_outreach_id INTEGER REFERENCES outreach(id),
  answer_pack TEXT,                -- JSON: full snapshot of this application's answers (auditable)
  filled_fields TEXT,              -- JSON: field->value list reported back by the executor
  confirm_decision TEXT,           -- NULL | approved | rejected
  needs_manual_reason TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,  -- user-priority flag from /queue; sorts first everywhere
  pending_questions TEXT,          -- JSON: [{key,label,hint?,options?}] the executor needs answered (status needs_info)
  info_answers TEXT,               -- JSON: {key: value} answers the user gave in-App for this application (merged into answerPack.custom)
  apply_mode TEXT,                 -- NULL (follow suggestion) | referral | direct — user override from /queue
  referral_info TEXT,              -- JSON {source, link?, code?, note?, at} once a referral is obtained
  referral_reached_at TEXT,        -- when the first referral request was actually sent (UTC)
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, job_id)
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  name TEXT NOT NULL,
  company TEXT,
  role_title TEXT,
  linkedin_url TEXT,
  email TEXT,
  email_status TEXT,               -- guessed | verified
  relation TEXT,                   -- recruiter | alum | hiring_manager | engineer
  source TEXT,
  notes TEXT,                      -- 会话在对方主页读到的 1–3 句事实观察(headline/About/近期动态);草稿里「关于对方那句话」的唯一来源
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, linkedin_url)
);

CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  person_id INTEGER NOT NULL REFERENCES people(id),
  job_id INTEGER REFERENCES jobs(id),
  playbook TEXT NOT NULL,          -- referral|self_pitch|recruiter|coffee_chat|hidden_opportunity|followup|thanks
  channel TEXT NOT NULL,           -- linkedin | email
  draft TEXT,
  draft_note TEXT,                 -- ≤200-char LinkedIn connection-note variant of draft (linkedin channel)
  referral_stage TEXT,             -- pending|accepted|replied|asked_resume|will_refer|referred|declined|no_headcount|other (Claude, src/network/harvest.ts)
  stage_summary TEXT,              -- one-line Claude summary of where the conversation stands
  stage_action TEXT,               -- suggested next action for the user
  stage_link TEXT,                 -- referral link/code the person sent, if any
  last_checked_at TEXT,            -- when the attended session last harvested this thread
  thread_log TEXT NOT NULL DEFAULT '[]',   -- JSON: [{at, dir: sent|received, text}]
  status TEXT NOT NULL DEFAULT 'draft',    -- draft|pending_send|sent|replied|meeting|referral_won|no_response
  outcome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach_jobs (
  outreach_id INTEGER NOT NULL REFERENCES outreach(id),
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  PRIMARY KEY (outreach_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_outreach_jobs_job ON outreach_jobs(job_id);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  tier INTEGER NOT NULL DEFAULT 2,
  ats TEXT,                        -- greenhouse | lever | ashby | workday | other
  board_token TEXT,
  careers_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  probe_status TEXT,               -- ok | failed | untested
  directions TEXT NOT NULL DEFAULT '[]'    -- JSON array of direction slugs
);

CREATE TABLE IF NOT EXISTS resumes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  version_name TEXT NOT NULL,
  directions TEXT NOT NULL DEFAULT '[]',
  tex_path TEXT,
  pdf_path TEXT,
  compiled_at TEXT,
  UNIQUE (user_id, version_name)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,                    -- NULL for machine-wide events (scan ticks, board retiers, job eligibility)
  kind TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  payload TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Machine-level key/value state (attended-session heartbeats / spawn records, keyed per user).
CREATE TABLE IF NOT EXISTS profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Each account's profile (contact, education, work authorization, directions, EEO, standard
-- answers) as JSON validated by src/lib/profile.ts's ProfileSchema. Replaces profile/profile.yaml.
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  kind TEXT NOT NULL,              -- education | work | project | skill | award | publication
  title TEXT NOT NULL,             -- 职位名 / 项目名 / 学位 / 技能组名
  organization TEXT,               -- 公司 / 学校 / 会议(skill 可空)
  location TEXT,
  start_date TEXT,                 -- 自由文本,如 "2025-09" 或 "Sep 2025"
  end_date TEXT,                   -- 自由文本 或 "Present"
  bullets TEXT NOT NULL DEFAULT '[]',   -- JSON: [{ text, directions: [slug,...] }]
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS executor_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT 'legacy',
  kind TEXT NOT NULL,            -- apply | network_send | network_find | jd_review | scan | referral_check
  status TEXT NOT NULL DEFAULT 'running',  -- queued | running | done | failed | stopped
  channel TEXT NOT NULL DEFAULT 'headless',  -- headless (Playwright, own Chrome profile) | user_chrome (attended session drives the user's own Chrome)
  pid INTEGER,
  log_path TEXT,
  options TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  claimed_at TEXT,               -- user_chrome only: when an attended session claimed a queued row
  ended_at TEXT
);

-- 信息源注册表:凡是被轮询的东西都是一行(spec 2026-09-06 job-sources §1)。
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,              -- family:ident
  family TEXT NOT NULL,                  -- greenhouse|lever|ashby|workday|bytedance|smartrecruiters|oracle|icims|workable|amazon|linkedin|github_list|chrome
  ident TEXT NOT NULL,
  company TEXT,
  origin TEXT NOT NULL,                  -- seed | url | directory | builtin | manual
  tier TEXT NOT NULL DEFAULT 'longtail', -- core(每小时) | longtail(每天) | dormant(每周) | muted
  tier_reason TEXT,
  tier_locked INTEGER NOT NULL DEFAULT 0,
  directions TEXT,                       -- JSON 数组,种子给的方向提示
  meta TEXT,                             -- JSON,适配器附加信息(如清单 ETag)
  next_due_at TEXT,                      -- NULL = 立刻到期
  last_polled_at TEXT,
  last_ok_at TEXT,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boards_due ON boards(tier, next_due_at);

-- ---- Accounts (Better Auth core tables; column names/types follow its sqlite mapping so its
-- ---- runtime schema check passes: string→TEXT, boolean→INTEGER, date→DATE). "user" is quoted
-- ---- everywhere for clarity, not because sqlite reserves it.
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'    -- owner (this box's principal; claimed the legacy data) | member
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY NOT NULL,
  expiresAt DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_userId_idx ON session(userId);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS account_userId_idx ON account(userId);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

-- Bearer tokens (src/lib/api-tokens.ts): personal tokens the user mints on 设置 for attended
-- sessions/scripts on their own machine, and short-lived run tokens the server hands to the
-- executor sessions it spawns. Only the sha256 is stored.
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'personal',   -- personal | run
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,                    -- the token's first characters, shown in the list
  run_id INTEGER,                          -- run tokens: the executor_runs row it belongs to
  expires_at TEXT,                         -- ISO; NULL = never
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, at);
CREATE INDEX IF NOT EXISTS idx_experiences_kind ON experiences(kind, sort_order);
-- Indexes on user_id live in db.ts (after migrations): this file is exec'd before an old db has
-- gained the column, and CREATE INDEX IF NOT EXISTS on a missing column is an error.

CREATE TRIGGER IF NOT EXISTS trg_applications_updated AFTER UPDATE ON applications
BEGIN
  UPDATE applications SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_experiences_updated AFTER UPDATE ON experiences
BEGIN UPDATE experiences SET updated_at = datetime('now') WHERE id = NEW.id; END;
