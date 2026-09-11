/**
 * The only place that talks to the Rust backend.
 *
 * Running in a plain browser (`npm run dev` without Tauri) falls back to an
 * in-memory stub so the UI can be developed and demoed anywhere.
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import { demoInvoke, isDemoMode } from "./demo";
import type {
  BulkEdit,
  BulkResult,
  Card,
  CardDraft,
  Deleted,
  GithubStatus,
  Grade,
  ImportResult,
  Library,
  RepoInfo,
  Review,
  SessionRequest,
  Settings,
  SettingsPatch,
  Similar,
  SyncReport,
  VaultCandidate,
} from "./types";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isDemoMode()) return demoInvoke<T>(cmd, args);
  return tauriInvoke<T>(cmd, args);
}

export const api = {
  getLibrary: () => call<Library>("get_library"),
  refresh: () => call<Library>("refresh_library"),
  getSettings: () => call<Settings>("get_settings"),
  updateSettings: (patch: SettingsPatch) => call<Library>("update_settings", { patch }),
  detectVaults: () => call<VaultCandidate[]>("detect_vaults"),
  setVault: (path: string, folder?: string) =>
    call<Library>("set_vault", { choice: { path, folder } }),
  useLocalVault: () => call<Library>("use_local_vault"),
  moveLocalCardsToVault: (path: string, folder?: string) =>
    call<Library>("move_local_cards_to_vault", { choice: { path, folder } }),
  saveCard: (draft: CardDraft) => call<Card>("save_card", { draft }),
  deleteCard: (id: string) => call<Deleted>("delete_card", { id }),
  restoreCard: (trashedPath: string) =>
    call<Library>("restore_card", { trashedPath }),
  dueCards: (limit?: number) => call<Card[]>("due_cards", { limit }),
  gradeCard: (id: string, grade: Grade) => call<Card>("grade_card", { id, grade }),
  obsidianUri: (id: string) => call<string>("obsidian_uri", { id }),

  // GitHub repository sync
  githubStatus: () => call<GithubStatus>("github_status"),
  githubConnect: (connection: {
    token: string;
    repo: string;
    branch?: string;
    folder?: string;
  }) => call<RepoInfo>("github_connect", { connection }),
  githubDisconnect: () => call<Library>("github_disconnect"),
  syncNow: () => call<SyncReport>("sync_now"),

  // Organising
  renameTag: (from: string, to: string) => call<BulkResult>("rename_tag", { from, to }),
  renameDeck: (from: string, to: string) => call<BulkResult>("rename_deck", { from, to }),
  bulkEdit: (edit: BulkEdit) => call<BulkResult>("bulk_edit", { edit }),
  bulkDelete: (ids: string[]) => call<Deleted[]>("bulk_delete", { ids }),
  restoreMany: (paths: string[]) => call<Library>("restore_many", { paths }),

  // Review
  reviewSession: (request: SessionRequest) =>
    call<Card[]>("review_session", { request }),
  restoreReview: (id: string, review: Review) =>
    call<Card>("restore_review", { id, review }),

  // Capture helpers, import and export
  findSimilar: (text: string, exclude?: string) =>
    call<Similar[]>("find_similar", { text, exclude }),
  importText: (request: {
    text: string;
    split?: "lines" | "blocks";
    kind?: string;
    deck?: string;
    tags?: string[];
  }) => call<ImportResult>("import_text", { request }),
  exportMarkdown: () => call<string>("export_markdown"),
  writeTextFile: (path: string, contents: string) =>
    call<void>("write_text_file", { path, contents }),
  readTextFile: (path: string) => call<string>("read_text_file", { path }),
  addSampleCards: () => call<Library>("add_sample_cards"),
};

/** Human-readable message for anything thrown by a command. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
