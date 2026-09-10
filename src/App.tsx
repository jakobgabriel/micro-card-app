import { useEffect, useState } from "react";
import { Home as HomeIcon, Layers, Plus, Repeat } from "lucide-react";

import { CaptureSheet } from "@/components/CaptureSheet";
import { CardDetailSheet } from "@/components/CardDetailSheet";
import { Spinner } from "@/components/ui";
import { Home } from "@/screens/Home";
import { LibraryScreen } from "@/screens/LibraryScreen";
import { Onboarding } from "@/screens/Onboarding";
import { Review } from "@/screens/Review";
import { SettingsScreen } from "@/screens/SettingsScreen";
import { useStore } from "@/lib/store";
import type { Card } from "@/lib/types";
import { cn, haptic, isDue } from "@/lib/utils";

type Tab = "home" | "library" | "review";

export function App() {
  const { library, loading, error, reload } = useStore();
  const [tab, setTab] = useState<Tab>("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [editing, setEditing] = useState<Card | null>(null);
  const [detail, setDetail] = useState<Card | null>(null);

  // Follow the theme choice, and keep the Android status bar colour in step.
  useEffect(() => {
    const dark = library?.settings.dark_mode ?? true;
    document.documentElement.classList.toggle("dark", dark);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#0d0b14" : "#f7f5fc");
  }, [library?.settings.dark_mode]);

  // Keep the open detail card in step with the library after an edit.
  useEffect(() => {
    if (!detail || !library) return;
    const fresh = library.cards.find((c) => c.id === detail.id) ?? null;
    if (fresh !== detail) setDetail(fresh);
  }, [library, detail]);

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
            className="mt-4 h-12 rounded-2xl bg-brand px-6 font-semibold text-white"
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

  if (settingsOpen) {
    return (
      <main className="h-full overflow-y-auto">
        <SettingsScreen onBack={() => setSettingsOpen(false)} />
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
            onReview={() => setTab("review")}
            onSettings={() => setSettingsOpen(true)}
          />
        )}
        {tab === "library" && <LibraryScreen onOpenCard={setDetail} />}
        {tab === "review" && <Review onExit={() => setTab("home")} />}
      </main>

      {tab !== "review" && (
        <>
          {/* Floating capture button: reachable from every list screen and
              never on top of a tab label. */}
          <button
            aria-label="Capture a card"
            onClick={() => {
              haptic(14);
              setCapturing(true);
            }}
            className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-30 grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-lift transition active:scale-90"
          >
            <Plus className="h-7 w-7" />
          </button>
          <TabBar tab={tab} dueCount={dueCount} onTab={setTab} />
        </>
      )}

      <CaptureSheet
        open={capturing || editing !== null}
        editing={editing}
        onClose={() => {
          setCapturing(false);
          setEditing(null);
        }}
      />

      <CardDetailSheet
        card={editing ? null : detail}
        onClose={() => setDetail(null)}
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
    { value: "review", label: "Review", icon: <Repeat className="h-5 w-5" />, badge: dueCount },
  ];

  return (
    <nav className="shrink-0 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="grid grid-cols-3 items-center">
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
                  <span className="absolute -right-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
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
