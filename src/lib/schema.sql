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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
  direction TEXT,
  score INTEGER,
  tier INTEGER,
  resume_id INTEGER REFERENCES resumes(id),
  reason TEXT,
  skip_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id),
  status TEXT NOT NULL DEFAULT 'discovered',
  -- discovered|matched|prepared|awaiting_confirm|submitted|oa|interview|offer|rejected|stale|archived
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  company TEXT,
  role_title TEXT,
  linkedin_url TEXT UNIQUE,
  email TEXT,
  email_status TEXT,               -- guessed | verified
  relation TEXT,                   -- recruiter | alum | hiring_manager | engineer
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id),
  job_id INTEGER REFERENCES jobs(id),
  playbook TEXT NOT NULL,          -- referral|self_pitch|recruiter|coffee_chat|hidden_opportunity|followup|thanks
  channel TEXT NOT NULL,           -- linkedin | email
  draft TEXT,
  thread_log TEXT NOT NULL DEFAULT '[]',   -- JSON: [{at, dir: sent|received, text}]
  status TEXT NOT NULL DEFAULT 'draft',    -- draft|pending_send|sent|replied|meeting|referral_won|no_response
  outcome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  version_name TEXT NOT NULL UNIQUE,
  directions TEXT NOT NULL DEFAULT '[]',
  tex_path TEXT,
  pdf_path TEXT,
  compiled_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  payload TEXT NOT NULL DEFAULT '{}',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS experiences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  kind TEXT NOT NULL,            -- apply | network_send | network_find
  status TEXT NOT NULL DEFAULT 'running',  -- running | done | failed | stopped
  pid INTEGER,
  log_path TEXT,
  options TEXT NOT NULL DEFAULT '{}',
  summary TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, at);
CREATE INDEX IF NOT EXISTS idx_experiences_kind ON experiences(kind, sort_order);

CREATE TRIGGER IF NOT EXISTS trg_applications_updated AFTER UPDATE ON applications
BEGIN
  UPDATE applications SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_experiences_updated AFTER UPDATE ON experiences
BEGIN UPDATE experiences SET updated_at = datetime('now') WHERE id = NEW.id; END;
