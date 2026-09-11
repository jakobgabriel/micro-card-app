import { useRef, useState } from "react";
import { Check, Star, Trash2 } from "lucide-react";

import type { Card } from "@/lib/types";
import {
  KIND_STYLE,
  cn,
  haptic,
  highlightRuns,
  isDue,
  plainText,
  previewAround,
  timeAgo,
} from "@/lib/utils";

/** Past this distance the swipe commits when the finger lifts. */
const COMMIT = 96;

/**
 * One card in the library list.
 *
 * Tap to open — or, while the list is in selection mode, to tick it. Swiping
 * right stars the card and swiping left deletes it, so the two things people
 * do most never need the card to be opened at all.
 */
export function CardTile({
  card,
  onOpen,
  selected,
  onStar,
  onDelete,
  query,
}: {
  card: Card;
  onOpen: (card: Card) => void;
  /** Undefined outside selection mode. */
  selected?: boolean;
  onStar?: (card: Card) => void;
  onDelete?: (card: Card) => void;
  /** The search that produced this result, for highlighting. */
  query?: string;
}) {
  const style = KIND_STYLE[card.kind];
  const body = plainText(card.kind === "qa" ? card.back || card.front : card.front);
  // Show the part of a long card that actually matched.
  const preview = query ? previewAround(body, query) : body;
  const due = isDue(card);

  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiping = useRef(false);
  /**
   * The live swipe distance.
   *
   * `offset` drives the rendering, but it cannot be trusted when the finger
   * lifts: React has not necessarily re-rendered since the last touchmove, so
   * a quick flick would read a stale zero and do nothing. The ref is the
   * source of truth for the decision; the state is only for drawing.
   */
  const distance = useRef(0);
  const swipeable = Boolean(onStar || onDelete) && selected === undefined;

  const finish = () => {
    const travelled = distance.current;
    const committed =
      travelled > COMMIT ? "star" : travelled < -COMMIT ? "delete" : null;
    setSettling(true);
    setOffset(0);
    distance.current = 0;
    start.current = null;
    if (committed === "star") {
      haptic(14);
      onStar?.(card);
    } else if (committed === "delete") {
      haptic([10, 40, 10]);
      onDelete?.(card);
    }
    window.setTimeout(() => setSettling(false), 220);
    // Let the tap handler know a swipe just happened, so lifting a finger
    // after dragging does not also open the card.
    window.setTimeout(() => {
      swiping.current = false;
    }, 0);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* What the swipe reveals underneath. */}
      {swipeable && offset !== 0 && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 flex items-center px-5 text-sm font-bold",
            offset > 0 ? "justify-start bg-accent/15 text-accent" : "justify-end bg-danger/15 text-danger",
          )}
        >
          {offset > 0 ? (
            <span className="flex items-center gap-2">
              <Star className={cn("h-5 w-5", card.starred && "fill-accent")} />
              {card.starred ? "Unstar" : "Star"}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Trash2 className="h-5 w-5" />
              Delete
            </span>
          )}
        </div>
      )}

      <button
        onClick={() => {
          if (swiping.current) return;
          onOpen(card);
        }}
        onTouchStart={(e) => {
          if (!swipeable) return;
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          if (!start.current) return;
          const dx = e.touches[0].clientX - start.current.x;
          const dy = e.touches[0].clientY - start.current.y;
          // Vertical intent wins: the list must still scroll normally.
          if (!swiping.current && Math.abs(dy) > Math.abs(dx)) {
            start.current = null;
            return;
          }
          if (Math.abs(dx) > 8) swiping.current = true;
          if (swiping.current) {
            distance.current = dx;
            setOffset(dx);
          }
        }}
        onTouchEnd={() => {
          if (start.current || swiping.current) finish();
        }}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        className={cn(
          "card-surface relative w-full p-4 text-left",
          settling && "transition-transform duration-200",
          !offset && "transition active:scale-[.985]",
          due && "border-brand/40",
          selected && "border-brand bg-brand-soft/40 ring-2 ring-brand",
        )}
      >
        {selected !== undefined && (
          <span
            className={cn(
              "float-right ml-2 grid h-6 w-6 place-items-center rounded-full border-2",
              selected ? "border-brand bg-brand text-brand-ink" : "border-line",
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" />}
          </span>
        )}
        <div className="mb-2 flex items-center gap-2">
          <span className={cn("chip", style.chip)}>{style.label}</span>
          {due && <span className="chip bg-brand text-brand-ink">Due</span>}
          {card.deck && <span className="chip bg-raised text-muted">{card.deck}</span>}
          <span className="ml-auto shrink-0 text-xs text-muted">{timeAgo(card.updated)}</span>
          {card.starred && <Star className="h-4 w-4 shrink-0 fill-accent text-accent" />}
        </div>

        <h3 className="clamp-2 text-[15px] font-bold leading-snug">
          <Highlighted text={card.title} query={query} />
        </h3>

        {preview && preview !== card.title && (
          <p className="clamp-2 mt-1 text-sm leading-relaxed text-muted">
            <Highlighted text={preview} query={query} />
          </p>
        )}

        {card.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {card.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="text-xs font-medium text-brand">
                #{tag}
              </span>
            ))}
            {card.tags.length > 4 && (
              <span className="text-xs text-muted">+{card.tags.length - 4}</span>
            )}
          </div>
        )}
      </button>
    </div>
  );
}

/** Text with the search terms picked out. */
function Highlighted({ text, query }: { text: string; query?: string }) {
  if (!query?.trim()) return <>{text}</>;
  return (
    <>
      {highlightRuns(text, query).map((run, index) =>
        run.match ? (
          <mark key={index} className="rounded bg-accent/25 text-ink">
            {run.text}
          </mark>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </>
  );
}
