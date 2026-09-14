export interface Bullet {
  text: string;
  directions: string[];
}

export interface Exp {
  id?: number;
  kind: string;
  title: string;
  organization?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  bullets: Bullet[];
  sort_order: number;
}

export const EXPERIENCE_KINDS = ["education", "work", "project", "skill", "award", "publication"] as const;

export interface ResumeRow {
  id: number;
  version_name: string;
  directions: string[];
  compiled_at: string;
}
