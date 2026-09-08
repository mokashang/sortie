// Routing sentinels shared by the /queue page (client) and the paged queue API (server).
// Neither ever appears as a matches.direction column value.
export const ALL_JOBS_DIRECTION = "__all__";
export const UNCLASSIFIED_DIRECTION = "未分类";
export const QUEUE_SORTS = ["composite", "score", "fresh", "company"] as const;
export type QueueSortKey = (typeof QUEUE_SORTS)[number];
export const QUEUE_MODES = ["all", "referral", "direct"] as const;
export type QueueModeKey = (typeof QUEUE_MODES)[number];
