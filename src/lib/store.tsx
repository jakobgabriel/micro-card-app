/**
 * One store for the whole app. Screens read `library` and call actions; the
 * backend is the single source of truth, so every action returns fresh data
 * rather than patching local state optimistically.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { api, errorMessage } from "./api";
import type {
  BulkEdit,
  Card,
  CardDraft,
  GithubStatus,
  Grade,
  Library,
  Review,
  SettingsPatch,
  SyncReport,
} from "./types";

interface StoreValue {
  library: Library | null;
  loading: boolean;
  error: string | null;
  /** GitHub connection state, refreshed alongside the library. */
  github: GithubStatus | null;
  syncing: boolean;
  reload: () => Promise<void>;
  saveCard: (draft: CardDraft) => Promise<Card>;
  deleteCard: (id: string) => Promise<{ undo: () => Promise<void> }>;
  deleteCards: (ids: string[]) => Promise<{ undo: () => Promise<void> }>;
  bulkEdit: (edit: BulkEdit) => Promise<number>;
  renameTag: (from: string, to: string) => Promise<number>;
  renameDeck: (from: string, to: string) => Promise<number>;
  gradeCard: (id: string, grade: Grade) => Promise<Card>;
  restoreReview: (id: string, review: Review) => Promise<void>;
  updateSettings: (patch: SettingsPatch) => Promise<void>;
  setVault: (path: string, folder?: string) => Promise<void>;
  moveLocalCardsToVault: (path: string, folder?: string) => Promise<void>;
  useLocalVault: () => Promise<void>;
  addSampleCards: () => Promise<void>;
  /** Run a sync. `quiet` is used by the automatic ones, which stay silent. */
  sync: (quiet?: boolean) => Promise<SyncReport | null>;
  refreshGithub: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const refreshing = useRef(false);
  const syncingRef = useRef(false);
  const autoSyncTimer = useRef<number | null>(null);

  const refreshGithub = useCallback(async () => {
    try {
      setGithub(await api.githubStatus());
    } catch {
      // The sync row simply stays as it was; this is never worth an error.
    }
  }, []);

  const reload = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      setLibrary(await api.refresh());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      refreshing.current = false;
    }
  }, []);

  const sync = useCallback(
    async (quiet = false): Promise<SyncReport | null> => {
      if (syncingRef.current) return null;
      syncingRef.current = true;
      setSyncing(true);
      try {
        const report = await api.syncNow();
        setLibrary(await api.refresh());
        await refreshGithub();
        return report;
      } catch (err) {
        // An automatic sync that fails (offline, say) must not interrupt
        // anyone; only a sync the user asked for reports its problems.
        if (!quiet) throw err;
        return null;
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [refreshGithub],
  );

  /** Sync a few seconds after a change, so a burst of edits makes one commit. */
  const scheduleAutoSync = useCallback(() => {
    if (!library?.settings.github || !library.settings.github_auto_sync) return;
    if (autoSyncTimer.current) window.clearTimeout(autoSyncTimer.current);
    autoSyncTimer.current = window.setTimeout(() => {
      void sync(true);
    }, 4000);
  }, [library?.settings.github, library?.settings.github_auto_sync, sync]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initial = await api.getLibrary();
        if (!cancelled) setLibrary(initial);
        await refreshGithub();
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshGithub]);

  // Re-read the vault whenever the app comes back to the foreground: this is
  // how edits made in Obsidian appear without any explicit sync step. When a
  // repository is connected, this is also when it is pulled.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void reload();
      if (library?.settings.github && library.settings.github_auto_sync) {
        void sync(true);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [reload, sync, library?.settings.github, library?.settings.github_auto_sync]);

  // One sync shortly after launch, so the phone starts from what the repo has.
  const launched = useRef(false);
  useEffect(() => {
    if (launched.current || !library?.settings.github) return;
    if (!library.settings.github_auto_sync) return;
    launched.current = true;
    const timer = window.setTimeout(() => void sync(true), 1200);
    return () => window.clearTimeout(timer);
  }, [library?.settings.github, library?.settings.github_auto_sync, sync]);

  const value = useMemo<StoreValue>(
    () => ({
      library,
      loading,
      error,
      github,
      syncing,
      reload,
      sync,
      refreshGithub,
      saveCard: async (draft) => {
        const card = await api.saveCard(draft);
        await reload();
        scheduleAutoSync();
        return card;
      },
      deleteCard: async (id) => {
        const deleted = await api.deleteCard(id);
        await reload();
        scheduleAutoSync();
        return {
          undo: async () => {
            setLibrary(await api.restoreCard(deleted.trashed_path));
            scheduleAutoSync();
          },
        };
      },
      deleteCards: async (ids) => {
        const deleted = await api.bulkDelete(ids);
        await reload();
        scheduleAutoSync();
        return {
          undo: async () => {
            setLibrary(await api.restoreMany(deleted.map((d) => d.trashed_path)));
            scheduleAutoSync();
          },
        };
      },
      bulkEdit: async (edit) => {
        const result = await api.bulkEdit(edit);
        await reload();
        scheduleAutoSync();
        return result.changed;
      },
      renameTag: async (from, to) => {
        const result = await api.renameTag(from, to);
        await reload();
        scheduleAutoSync();
        return result.changed;
      },
      renameDeck: async (from, to) => {
        const result = await api.renameDeck(from, to);
        await reload();
        scheduleAutoSync();
        return result.changed;
      },
      gradeCard: async (id, grade) => {
        const card = await api.gradeCard(id, grade);
        await reload();
        scheduleAutoSync();
        return card;
      },
      restoreReview: async (id, review) => {
        await api.restoreReview(id, review);
        await reload();
      },
      updateSettings: async (patch) => {
        setLibrary(await api.updateSettings(patch));
      },
      setVault: async (path, folder) => {
        setLibrary(await api.setVault(path, folder));
      },
      moveLocalCardsToVault: async (path, folder) => {
        setLibrary(await api.moveLocalCardsToVault(path, folder));
      },
      useLocalVault: async () => {
        setLibrary(await api.useLocalVault());
      },
      addSampleCards: async () => {
        setLibrary(await api.addSampleCards());
        scheduleAutoSync();
      },
    }),
    [
      library,
      loading,
      error,
      github,
      syncing,
      reload,
      sync,
      refreshGithub,
      scheduleAutoSync,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
