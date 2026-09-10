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
import type { Card, CardDraft, Grade, Library, Settings } from "./types";

interface StoreValue {
  library: Library | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  saveCard: (draft: CardDraft) => Promise<Card>;
  deleteCard: (id: string) => Promise<{ undo: () => Promise<void> }>;
  gradeCard: (id: string, grade: Grade) => Promise<Card>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  setVault: (path: string, folder?: string) => Promise<void>;
  moveLocalCardsToVault: (path: string, folder?: string) => Promise<void>;
  useLocalVault: () => Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshing = useRef(false);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const initial = await api.getLibrary();
        if (!cancelled) setLibrary(initial);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-read the vault whenever the app comes back to the foreground: this is
  // how edits made in Obsidian appear without any explicit sync step.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [reload]);

  const value = useMemo<StoreValue>(
    () => ({
      library,
      loading,
      error,
      reload,
      saveCard: async (draft) => {
        const card = await api.saveCard(draft);
        await reload();
        return card;
      },
      deleteCard: async (id) => {
        const deleted = await api.deleteCard(id);
        await reload();
        return {
          undo: async () => {
            setLibrary(await api.restoreCard(deleted.trashed_path));
          },
        };
      },
      gradeCard: async (id, grade) => {
        const card = await api.gradeCard(id, grade);
        await reload();
        return card;
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
    }),
    [library, loading, error, reload],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
