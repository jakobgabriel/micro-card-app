/**
 * Everything captured, with search, one-tap filters and a selection mode for
 * tidying up in bulk. Long-press a card to start selecting — the same gesture
 * every phone gallery uses.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCheck,
  Hash,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { CardTile } from "@/components/CardTile";
import { Sheet } from "@/components/Sheet";
import { Button, Chip, EmptyState, IconButton } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Card, CardKind } from "@/lib/types";
import { KIND_STYLE, cn, haptic, isDue, searchCards } from "@/lib/utils";

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

export function LibraryScreen({
  onOpenCard,
  initialQuery,
  onSelectionChange,
}: {
  onOpenCard: (card: Card) => void;
  /** Set when arriving from a deck or tag in Browse. */
  initialQuery?: string;
  /** Lets the shell hide the capture button while cards are being selected. */
  onSelectionChange?: (active: boolean) => void;
}) {
  const { library, deleteCards, bulkEdit } = useStore();
  const toast = useToast();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [deck, setDeck] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [tagSheet, setTagSheet] = useState(false);
  const [bulkTag, setBulkTag] = useState("");
  const longPress = useRef<number | null>(null);

  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    onSelectionChange?.(selection !== null);
  }, [selection, onSelectionChange]);

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
  const selecting = selection !== null;
  const selected = selection ?? [];

  const toggle = (id: string) => {
    haptic(8);
    setSelection((current) => {
      const list = current ?? [];
      return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
    });
  };

  const startSelecting = (id: string) => {
    haptic(18);
    setSelection([id]);
  };

  const removeSelected = async () => {
    const ids = [...selected];
    setSelection(null);
    try {
      const { undo } = await deleteCards(ids);
      toast.success(`${ids.length} card${ids.length === 1 ? "" : "s"} moved to trash`, {
        label: "Undo",
        run: () => void undo(),
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const applyTag = async () => {
    const tag = bulkTag.trim().replace(/^#/, "");
    if (!tag) return;
    const ids = [...selected];
    setTagSheet(false);
    setBulkTag("");
    setSelection(null);
    try {
      const changed = await bulkEdit({ ids, add_tags: [tag] });
      toast.success(`#${tag} added to ${changed} card${changed === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const starSelected = async () => {
    const ids = [...selected];
    setSelection(null);
    try {
      const changed = await bulkEdit({ ids, starred: true });
      toast.success(`Starred ${changed} card${changed === 1 ? "" : "s"}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 bg-bg/95 px-4 pb-2 pt-4 backdrop-blur">
        {selecting ? (
          <div className="flex h-12 items-center gap-1 animate-fade-in">
            <IconButton label="Cancel selection" onClick={() => setSelection(null)}>
              <X className="h-5 w-5" />
            </IconButton>
            <p className="flex-1 font-bold">
              {selected.length} selected
            </p>
            <IconButton
              label="Select all"
              onClick={() => setSelection(visible.map((c) => c.id))}
            >
              <CheckCheck className="h-5 w-5" />
            </IconButton>
          </div>
        ) : (
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
        )}

        {!selecting && (
          <>
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
          </>
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
              {!selecting && visible.length > 1 && " · hold one to select"}
            </p>
            {visible.map((card) => (
              <div
                key={card.id}
                className="relative"
                onTouchStart={() => {
                  longPress.current = window.setTimeout(() => startSelecting(card.id), 450);
                }}
                onTouchEnd={() => {
                  if (longPress.current) window.clearTimeout(longPress.current);
                }}
                onTouchMove={() => {
                  if (longPress.current) window.clearTimeout(longPress.current);
                }}
                onContextMenu={(e) => {
                  // Right-click is the desktop equivalent of a long press.
                  e.preventDefault();
                  startSelecting(card.id);
                }}
              >
                <CardTile
                  card={card}
                  selected={selecting ? selected.includes(card.id) : undefined}
                  onOpen={selecting ? () => toggle(card.id) : onOpenCard}
                />
              </div>
            ))}
          </>
        )}
      </div>

      {selecting && selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 pb-3 animate-slide-up">
          <div className="flex w-full max-w-sm items-center gap-1 rounded-2xl border border-line bg-surface p-1.5 shadow-lift">
            <BulkAction icon={<Hash className="h-5 w-5" />} label="Tag" onClick={() => setTagSheet(true)} />
            <BulkAction icon={<Star className="h-5 w-5" />} label="Star" onClick={() => void starSelected()} />
            <BulkAction
              icon={<Trash2 className="h-5 w-5" />}
              label="Delete"
              tone="danger"
              onClick={() => void removeSelected()}
            />
          </div>
        </div>
      )}

      <Sheet
        open={tagSheet}
        onClose={() => setTagSheet(false)}
        title={`Tag ${selected.length} card${selected.length === 1 ? "" : "s"}`}
        footer={
          <Button size="lg" block disabled={!bulkTag.trim()} onClick={() => void applyTag()}>
            Add tag
          </Button>
        }
      >
        <input
          value={bulkTag}
          onChange={(e) => setBulkTag(e.target.value)}
          autoFocus
          placeholder="to-read"
          className="h-12 w-full rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(library?.stats.tags ?? []).slice(0, 8).map((tag) => (
            <Chip key={tag.name} onClick={() => setBulkTag(tag.name)}>
              #{tag.name}
            </Chip>
          ))}
        </div>
      </Sheet>
    </div>
  );
}

function BulkAction({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      className={cn(
        "flex h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-bold transition active:scale-95",
        tone === "danger" ? "text-danger active:bg-danger/10" : "text-ink active:bg-raised",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
