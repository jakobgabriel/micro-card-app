/** Today at a glance: what is due, what you captured, and one big way in. */
import { useMemo } from "react";
import {
  ArrowRight,
  Flame,
  Inbox,
  PenLine,
  Settings2,
  Sparkles,
} from "lucide-react";

import { CardTile } from "@/components/CardTile";
import { Button, EmptyState, IconButton, ProgressRing } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { Card } from "@/lib/types";
import { isDue } from "@/lib/utils";

interface Props {
  onCapture: () => void;
  onOpenCard: (card: Card) => void;
  onReview: () => void;
  onSettings: () => void;
}

export function Home({ onCapture, onOpenCard, onReview, onSettings }: Props) {
  const { library } = useStore();
  const stats = library?.stats;
  const cards = library?.cards ?? [];

  const recent = useMemo(() => cards.slice(0, 6), [cards]);
  const dueCount = useMemo(() => cards.filter(isDue).length, [cards]);
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "Still up?";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  return (
    <div className="px-4 pb-28 pt-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted">{greeting}</p>
          <h1 className="text-2xl font-black">Your cards</h1>
        </div>
        <div className="flex items-center gap-1">
          {(stats?.streak_days ?? 0) > 0 && (
            <span className="chip bg-accent/15 text-accent">
              <Flame className="h-3.5 w-3.5" />
              {stats?.streak_days}
            </span>
          )}
          <IconButton label="Settings" onClick={onSettings}>
            <Settings2 className="h-5 w-5" />
          </IconButton>
        </div>
      </header>

      {/* Primary action. Deliberately the largest thing on the screen. */}
      <button
        onClick={onCapture}
        className="mt-4 flex w-full items-center gap-3 rounded-3xl bg-brand p-5 text-left text-white shadow-lift transition active:scale-[.98]"
      >
        <PenLine className="h-6 w-6 shrink-0" />
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">Capture a card</p>
          <p className="text-sm text-white/80">One idea, a few seconds.</p>
        </div>
        <ArrowRight className="ml-auto h-5 w-5 shrink-0 opacity-80" />
      </button>

      {dueCount > 0 && (
        <button
          onClick={onReview}
          className="card-surface mt-3 flex w-full items-center gap-4 p-4 text-left active:scale-[.98]"
        >
          <ProgressRing
            value={stats?.reviewed_today ?? 0}
            max={Math.max(1, library?.settings.daily_goal ?? 20)}
          >
            {stats?.reviewed_today ?? 0}
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              {dueCount} card{dueCount === 1 ? "" : "s"} ready to review
            </p>
            <p className="text-sm text-muted">
              {(stats?.reviewed_today ?? 0) > 0
                ? `${stats?.reviewed_today} done today — keep going.`
                : "A two-minute session is enough."}
            </p>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-muted" />
        </button>
      )}

      <div className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="Cards" value={stats?.total ?? 0} />
        <Stat label="Today" value={stats?.captured_today ?? 0} />
        <Stat label="Due" value={dueCount} highlight={dueCount > 0} />
      </div>

      <h2 className="mb-2 mt-6 px-1 text-sm font-bold uppercase tracking-wide text-muted">
        Recent
      </h2>

      {recent.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-7 w-7" />}
          title="Nothing captured yet"
          description="Write down the next thing you want to remember — a fact, a quote, a half-formed idea. You can tidy it up later."
          action={
            <Button className="mt-2" onClick={onCapture} icon={<PenLine className="h-4 w-4" />}>
              Write your first card
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {recent.map((card) => (
            <CardTile key={card.id} card={card} onOpen={onOpenCard} />
          ))}
        </div>
      )}

      {library?.local_mode && recent.length > 0 && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-dashed border-line p-4 text-sm text-muted">
          <Inbox className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">
            Cards are stored on this device only. Connect an Obsidian vault in
            Settings and they move across with you.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="card-surface px-3 py-3 text-center">
      <p className={highlight ? "text-2xl font-black text-brand" : "text-2xl font-black"}>
        {value}
      </p>
      <p className="text-xs font-medium text-muted">{label}</p>
    </div>
  );
}
