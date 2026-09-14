// Client-safe display labels (no db imports). Every enum/slug the UI shows goes through one of
// these maps so internal names (run statuses, ATS kinds, eligibility codes) never leak on screen.
export { directionLabel, DIRECTIONS } from "@/matcher/directions";

export type Tone = "neutral" | "accent" | "good" | "warn" | "danger" | "info";

export const RUN_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  done: "已完成",
  failed: "失败",
  stopped: "已停止",
};

export const RUN_STATUS_TONE: Record<string, Tone> = {
  queued: "info",
  running: "accent",
  done: "good",
  failed: "danger",
  stopped: "neutral",
};

export const RUN_KIND_LABEL: Record<string, string> = {
  apply: "投递",
  network_send: "发消息",
  network_find: "找人",
  jd_review: "补正文",
  scan: "Chrome 扫描",
  referral_check: "检查内推回复",
};

export const CHANNEL_LABEL: Record<string, string> = {
  user_chrome: "在我的 Chrome 里",
  headless: "后台浏览器",
};

export const EXPERIENCE_KIND_LABEL: Record<string, string> = {
  education: "教育",
  work: "工作",
  project: "项目",
  skill: "技能",
  award: "奖项",
  publication: "论文",
};

// 待处理 card item kinds (src/apply/queue.ts InfoKind).
export const INFO_KIND_LABEL: Record<string, string> = {
  text: "补信息",
  file: "传文件",
  login: "登录一次",
  action: "现场完成",
  manual: "亲自完成",
};

// Friendly names for the standing documents in data/documents (src/lib/documents.ts); any
// other key is shown as-is.
export const DOCUMENT_LABELS: Record<string, string> = {
  transcript: "成绩单(研究生)",
  transcript_undergrad: "成绩单(本科)",
  cover_letter: "Cover letter 模板",
  portfolio: "作品集",
  headshot: "证件照",
  writing_sample: "写作样本",
  diploma: "学位证明",
};

export function documentLabel(key: string): string {
  return DOCUMENT_LABELS[key] ?? key;
}

export const SPONSORSHIP_LABEL: Record<string, string> = {
  yes: "提供签证",
  no: "不提供签证",
  unknown: "签证未知",
};

export const DEGREE_LABEL: Record<string, string> = {
  ms_ok: "硕士可投",
  phd_only: "仅限博士",
};

export const ROLE_KIND_LABEL: Record<string, string> = {
  eng: "工程岗",
  non_tech: "非技术岗",
};

export const JD_STATUS_LABEL: Record<string, string> = {
  missing: "无正文",
  login_wall: "登录墙",
  unreachable: "打不开",
};

export const OUTREACH_STATUS_LABEL: Record<string, string> = {
  draft: "待你批准",
  pending_send: "已批准,等助手发送",
  sent: "已发出,等回复",
  accepted: "已接受邀请,未回",
  replied: "已回复",
  referral_won: "已拿到内推",
  no_response: "无回应",
  archived: "已作废",
};

export const OUTREACH_STATUS_TONE: Record<string, Tone> = {
  draft: "warn",
  pending_send: "info",
  sent: "good",
  accepted: "good",
  replied: "good",
  referral_won: "good",
  no_response: "neutral",
  archived: "neutral",
};

export const REFERRAL_STAGE_LABEL: Record<string, string> = {
  pending: "邀请待接受",
  accepted: "已接受未回",
  replied: "已回复",
  asked_resume: "对方要简历/信息",
  will_refer: "答应内推",
  referred: "已内推",
  declined: "婉拒",
  no_headcount: "没名额 / 岗位关了",
  other: "其他",
};

export const REFERRAL_STAGE_TONE: Record<string, Tone> = {
  pending: "neutral",
  accepted: "info",
  replied: "good",
  asked_resume: "warn",
  will_refer: "good",
  referred: "good",
  declined: "danger",
  no_headcount: "danger",
  other: "neutral",
};

export const RELATION_LABEL: Record<string, string> = {
  recruiter: "招聘方",
  alum: "校友",
  hiring_manager: "用人经理",
  engineer: "工程师",
  other: "其他",
};

export const PLAYBOOK_LABEL: Record<string, string> = {
  referral: "内推请求",
  self_pitch: "毛遂自荐",
  recruiter: "投递后联系招聘方",
  coffee_chat: "请教 15 分钟",
  hidden_opportunity: "探索性请教",
  followup: "礼貌跟进",
  thanks: "面试后感谢",
};

export const MSG_CHANNEL_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  email: "邮件",
};

export const REFERRAL_SOURCE_LABEL: Record<string, string> = {
  linkedin: "LinkedIn",
  email: "邮件",
  wechat: "微信",
  other: "其他",
};

export function labelOf(map: Record<string, string>, key: string | null | undefined, fallback = "—"): string {
  if (key == null) return fallback;
  return map[key] ?? fallback;
}

export function tierLabel(tier: number | null | undefined): string {
  return tier == null ? "未分梯队" : `梯队 ${tier}`;
}

// The effective apply mode as shown on a queue row: a resolved 'referral' is always 内推; a
// resolved 'direct' is 海投 only once Claude has actually classified the job (referral_fit set),
// otherwise it is just the default and reads as 未判定.
export function modeLabel(mode: "referral" | "direct" | null | undefined, fit?: number | null): string {
  if (mode === "referral") return "内推";
  if (mode === "direct") return fit == null ? "未判定" : "海投";
  return "未判定";
}
