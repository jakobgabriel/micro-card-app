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

export interface Settings {
  vault_path: string | null;
  folder: string;
  default_tag: string;
  onboarded: boolean;
  dark_mode: boolean;
  daily_goal: number;
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

export interface Stats {
  total: number;
  due: number;
  captured_today: number;
  reviewed_today: number;
  streak_days: number;
  decks: DeckStat[];
  tags: TagStat[];
}

export interface Library {
  cards: Card[];
  stats: Stats;
  settings: Settings;
  vault_root: string;
  local_mode: boolean;
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

export const KIND_LABELS: Record<CardKind, string> = {
  note: "Note",
  qa: "Q & A",
  idea: "Idea",
  quote: "Quote",
  task: "To-do",
};
