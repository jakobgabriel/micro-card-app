/**
 * The only place that talks to the Rust backend.
 *
 * Running in a plain browser (`npm run dev` without Tauri) falls back to an
 * in-memory stub so the UI can be developed and demoed anywhere.
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import { demoInvoke, isDemoMode } from "./demo";
import type {
  Card,
  CardDraft,
  Deleted,
  Grade,
  Library,
  Settings,
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
  updateSettings: (patch: Partial<Settings>) =>
    call<Library>("update_settings", { patch }),
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
};

/** Human-readable message for anything thrown by a command. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
