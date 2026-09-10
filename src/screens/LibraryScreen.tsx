/** Everything captured, with search and one-tap filters. */
import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, Star, X } from "lucide-react";

import { CardTile } from "@/components/CardTile";
import { Chip, EmptyState } from "@/components/ui";
import { useStore } from "@/lib/store";
import type { Card, CardKind } from "@/lib/types";
import { KIND_STYLE, cn, isDue, searchCards } from "@/lib/utils";

type Filter = "all" | "due" | "starred" | CardKind;

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "due", label: "Due" },
  { value: "starred", label: "Starred" },
  { value: "note", label: KIND_STYLE.note.label },
  { value: "qa", label: KIND_STYLE.qa.label },
  { value: "idea", label: KIND_STYLE.idea.label },
  { value: "quote", label: KIND_STYLE.quote.label },
  { value: "task", label: KIND_STYLE.task.label },
];

export function LibraryScreen({ onOpenCard }: { onOpenCard: (card: Card) => void }) {
  const { library } = useStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [deck, setDeck] = useState<string | null>(null);

  const cards = library?.cards ?? [];
  const decks = library?.stats.decks ?? [];

  const visible = useMemo(() => {
    let result = searchCards(cards, query);
    if (deck) result = result.filter((c) => (c.deck ?? "Inbox") === deck);
    if (filter === "due") result = result.filter(isDue);
    else if (filter === "starred") result = result.filter((c) => c.starred);
    else if (filter !== "all") result = result.filter((c) => c.kind === filter);
    return result;
  }, [cards, query, filter, deck]);

  const filtersActive = filter !== "all" || deck !== null;

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 bg-bg/95 px-4 pb-2 pt-4 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your cards…"
            inputMode="search"
            className={cn(
              "h-12 w-full rounded-2xl border border-line bg-surface pl-11 pr-11",
              "text-[15px] outline-none focus:border-brand",
            )}
          />
          {query && (
            <button
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-muted active:bg-raised"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          )}
        </div>

        <div className="no-scrollbar -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 pb-1">
          {FILTERS.map((option) => (
            <Chip
              key={option.value}
              active={filter === option.value}
              onClick={() => setFilter(option.value)}
              className="shrink-0 px-3 py-1.5"
            >
              {option.value === "starred" && <Star className="h-3.5 w-3.5" />}
              {option.label}
            </Chip>
          ))}
        </div>

        {decks.length > 1 && (
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 pt-1.5">
            <Chip
              active={deck === null}
              onClick={() => setDeck(null)}
              className="shrink-0 px-3 py-1.5"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              All decks
            </Chip>
            {decks.map((d) => (
              <Chip
                key={d.name}
                active={deck === d.name}
                onClick={() => setDeck(deck === d.name ? null : d.name)}
                className="shrink-0 px-3 py-1.5"
              >
                {d.name} · {d.count}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-2.5 px-4 pb-28 pt-2">
        {visible.length === 0 ? (
          <EmptyState
            icon={<Search className="h-7 w-7" />}
            title={query || filtersActive ? "Nothing matches" : "No cards yet"}
            description={
              query || filtersActive
                ? "Try fewer words, or clear the filters above. Search also understands #tags and deck:name."
                : "Capture your first card and it will show up here."
            }
          />
        ) : (
          <>
            <p className="px-1 pb-1 text-xs font-medium text-muted">
              {visible.length} card{visible.length === 1 ? "" : "s"}
            </p>
            {visible.map((card) => (
              <CardTile key={card.id} card={card} onOpen={onOpenCard} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
