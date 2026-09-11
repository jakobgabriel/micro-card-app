/** Mirrors the Rust model in `src-tauri/src/model.rs`. */

export type CardKind = "note" | "qa" | "idea" | "quote" | "task";

export type Grade = "again" | "good" | "easy";

export interface Review {
  due: string;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
}

export interface Card {
  id: string;
  kind: CardKind;
  title: string;
  front: string;
  back: string;
  tags: string[];
  deck: string | null;
  created: string;
  updated: string;
  starred: boolean;
  review: Review;
  path: string;
  links: string[];
}

export interface CardDraft {
  id?: string;
  kind?: CardKind;
  title?: string;
  front: string;
  back?: string;
  tags?: string[];
  deck?: string | null;
  starred?: boolean;
}

export type Theme = "system" | "light" | "dark";

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
}

export interface Settings {
  vault_path: string | null;
  folder: string;
  default_tag: string;
  onboarded: boolean;
  theme: Theme;
  text_scale: number;
  daily_goal: number;
  session_size: number;
  reminder_hour: number | null;
  github: RepoConfig | null;
  github_auto_sync: boolean;
}

/** Patch shape accepted by `update_settings`. */
export interface SettingsPatch {
  folder?: string;
  default_tag?: string;
  onboarded?: boolean;
  theme?: Theme;
  text_scale?: number;
  daily_goal?: number;
  session_size?: number;
  reminder_hour?: number | null;
  github_auto_sync?: boolean;
}

export interface DeckStat {
  name: string;
  count: number;
  due: number;
}

export interface TagStat {
  name: string;
  count: number;
}

export interface KindStat {
  kind: CardKind;
  count: number;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface Stats {
  total: number;
  due: number;
  captured_today: number;
  reviewed_today: number;
  streak_days: number;
  best_streak: number;
  decks: DeckStat[];
  tags: TagStat[];
  kinds: KindStat[];
  activity: DayCount[];
  forecast: DayCount[];
  /** 0.0–1.0 over the last month, or null until there is enough history. */
  retention: number | null;
}

export interface GithubStatus {
  connected: boolean;
  repo: string | null;
  branch: string | null;
  auto_sync: boolean;
  last_synced: string | null;
  last_commit: string | null;
  tracked_files: number;
}

export interface RepoInfo {
  full_name: string;
  private: boolean;
  default_branch: string;
  can_write: boolean;
  existing_cards: number;
}

export interface SyncReport {
  pulled: number;
  pushed: number;
  deleted_local: number;
  deleted_remote: number;
  conflicts: string[];
  commit: string | null;
  summary: string;
}

export interface Similar {
  id: string;
  title: string;
  score: number;
}

export interface BulkResult {
  changed: number;
}

export interface ImportResult {
  created: number;
  skipped: number;
}

export interface SessionRequest {
  deck?: string | null;
  tag?: string | null;
  cram?: boolean;
  limit?: number;
}

export interface BulkEdit {
  ids: string[];
  add_tags?: string[];
  remove_tags?: string[];
  deck?: string;
  starred?: boolean;
}

export interface Library {
  cards: Card[];
  stats: Stats;
  settings: Settings;
  vault_root: string;
  /** Absolute path of the folder holding photos attached to cards. */
  attachments_dir: string;
  local_mode: boolean;
}

export interface Attachment {
  name: string;
  path: string;
}

export interface OrphanedAttachment {
  name: string;
  size_bytes: number;
}

export interface VaultCandidate {
  name: string;
  path: string;
  note_count: number;
}

export interface Deleted {
  id: string;
  trashed_path: string;
}

export interface TrashedCard {
  path: string;
  title: string;
  kind: CardKind;
  preview: string;
  deleted_at: string;
}

export interface SharedText {
  text: string;
  subject: string | null;
  source: string | null;
}

export type ExportFormat = "markdown" | "csv" | "json";

export interface MergeResult {
  card: Card;
  trashed: Deleted[];
}

export const KIND_LABELS: Record<CardKind, string> = {
  note: "Note",
  qa: "Q & A",
  idea: "Idea",
  quote: "Quote",
  task: "To-do",
};
