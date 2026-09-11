import { useCallback, useEffect, useRef, useState } from "react";
import { Compass, Home as HomeIcon, Layers, Plus, Repeat } from "lucide-react";

import { CaptureSheet } from "@/components/CaptureSheet";
import { CardDetailSheet } from "@/components/CardDetailSheet";
import { Spinner } from "@/components/ui";
import { Browse } from "@/screens/Browse";
import { Home } from "@/screens/Home";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { Onboarding } from "@/screens/Onboarding";
import { Review } from "@/screens/Review";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { Stats } from "@/screens/Stats";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import type { Card, SessionRequest } from "@/lib/types";
import { cn, haptic, isDue } from "@/lib/utils";

type Tab = "home" | "library" | "browse" | "review";
/** Screens that cover the tabs rather than living inside them. */
type Overlay = "settings" | "stats" | null;

export function App() {
  const { library, loading, error, reload } = useStore();
  const [tab, setTab] = useState<Tab>("home");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [capturing, setCapturing] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const [detail, setDetail] = useState<Card | null>(null);
  const [libraryQuery, setLibraryQuery] = useState<string | undefined>();
  const [sessionFilter, setSessionFilter] = useState<SessionRequest | undefined>();
  const [selecting, setSelecting] = useState(false);
  /** Text shared in from another app, waiting to become a card. */
  const [sharedDraft, setSharedDraft] = useState<string | undefined>();

  const settings = library?.settings;

  // Apply the theme, and keep following the system setting while open.
  useEffect(() => {
    if (!settings) return;
    applyTheme(settings);
    if (settings.theme !== "system") return;
    return watchSystemTheme(() => applyTheme(settings));
  }, [settings]);

  // Pick up anything shared in from another app, on launch and whenever the
  // app comes forward — which is exactly when Android hands a share over.
  const collectingShare = useRef(false);
  useEffect(() => {
    const collect = async () => {
      if (collectingShare.current) return;
      collectingShare.current = true;
      try {
        const shared = await api.takeSharedText();
        if (shared?.text?.trim()) {
          // A subject (a page title, an email subject) makes a better first
          // line than the raw text that follows it.
          const text = shared.subject?.trim()
            ? `${shared.subject.trim()}\n\n${shared.text.trim()}`
            : shared.text.trim();
          setSharedDraft(text);
        }
      } catch {
        // No share waiting, or a platform without one.
      } finally {
        collectingShare.current = false;
      }
    };
    void collect();
    const onVisible = () => {
      if (document.visibilityState === "visible") void collect();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Keep the open detail card in step with the library after an edit.
  useEffect(() => {
    if (!detail || !library) return;
    const fresh = library.cards.find((c) => c.id === detail.id) ?? null;
    if (fresh !== detail) setDetail(fresh);
  }, [library, detail]);

  const openLibraryWith = useCallback((query: string) => {
    setLibraryQuery(query);
    setTab("library");
  }, []);

  const startSession = useCallback((filter?: SessionRequest) => {
    setSessionFilter(filter);
    setTab("review");
  }, []);

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  if (error && !library) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div>
          <p className="text-lg font-bold">Could not open your cards</p>
          <p className="mt-2 text-sm text-muted">{error}</p>
          <button
            onClick={() => void reload()}
            className="mt-4 h-12 rounded-2xl bg-brand px-6 font-semibold text-brand-ink"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (library && !library.settings.onboarded) {
    return <Onboarding />;
  }

  const dueCount = (library?.cards ?? []).filter(isDue).length;

  if (overlay) {
    return (
      <main className="h-full overflow-y-auto">
        {overlay === "settings" ? (
          <SettingsScreen onBack={() => setOverlay(null)} />
        ) : (
          <Stats onBack={() => setOverlay(null)} />
        )}
      </main>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === "home" && (
          <Home
            onCapture={() => setCapturing(true)}
            onOpenCard={setDetail}
            onReview={() => startSession(undefined)}
            onSettings={() => setOverlay("settings")}
            onStats={() => setOverlay("stats")}
          />
        )}
        {tab === "library" && (
          <LibraryScreen
            onOpenCard={setDetail}
            initialQuery={libraryQuery}
            onSelectionChange={setSelecting}
          />
        )}
        {tab === "browse" && (
          <Browse
            onOpenFilter={openLibraryWith}
            onStudy={(filter) => startSession(filter)}
          />
        )}
        {tab === "review" && (
          <Review
            filter={sessionFilter}
            onExit={() => {
              setSessionFilter(undefined);
              setTab("home");
            }}
          />
        )}
      </main>

      {tab !== "review" && (
        <>
          {/* Floating capture button: reachable from every list screen and
              never on top of a tab label. It steps aside while cards are
              being selected, where the bulk actions take that corner. */}
          {!selecting && (
          <button
            aria-label="Capture a card"
            onClick={() => {
              haptic(14);
              setCapturing(true);
            }}
            className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-brand-ink shadow-lift transition active:scale-90"
          >
            <Plus className="h-7 w-7" />
          </button>
          )}
          <TabBar
            tab={tab}
            dueCount={dueCount}
            onTab={(next) => {
              if (next !== "library") setSelecting(false);
              if (next === "library") setLibraryQuery(undefined);
              if (next === "review") setSessionFilter(undefined);
              setTab(next);
            }}
          />
        </>
      )}

      <CaptureSheet
        open={capturing || editing !== null || sharedDraft !== undefined}
        editing={editing}
        initialText={sharedDraft}
        onClose={() => {
          setCapturing(false);
          setEditing(null);
          setSharedDraft(undefined);
        }}
      />

      <CardDetailSheet
        card={editing ? null : detail}
        onClose={() => setDetail(null)}
        onOpen={setDetail}
        onEdit={(card) => {
          setDetail(null);
          setEditing(card);
        }}
      />
    </div>
  );
}

function TabBar({
  tab,
  dueCount,
  onTab,
}: {
  tab: Tab;
  dueCount: number;
  onTab: (tab: Tab) => void;
}) {
  const items: { value: Tab; label: string; icon: JSX.Element; badge?: number }[] = [
    { value: "home", label: "Home", icon: <HomeIcon className="h-5 w-5" /> },
    { value: "library", label: "Cards", icon: <Layers className="h-5 w-5" /> },
    { value: "browse", label: "Browse", icon: <Compass className="h-5 w-5" /> },
    { value: "review", label: "Review", icon: <Repeat className="h-5 w-5" />, badge: dueCount },
  ];

  return (
    <nav className="shrink-0 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="grid grid-cols-4 items-center">
        {items.map((item) => {
          const active = tab === item.value;
          return (
            <button
              key={item.value}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                haptic(8);
                onTab(item.value);
              }}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition",
                active ? "text-brand" : "text-muted",
              )}
            >
              <span className="relative">
                {item.icon}
                {item.badge ? (
                  <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-ink">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                ) : null}
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
