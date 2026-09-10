import { Star } from "lucide-react";

import type { Card } from "@/lib/types";
import { KIND_STYLE, cn, isDue, plainText, timeAgo } from "@/lib/utils";

/** One card in the library list. Tap anywhere to open it. */
export function CardTile({ card, onOpen }: { card: Card; onOpen: (card: Card) => void }) {
  const style = KIND_STYLE[card.kind];
  const preview = plainText(card.kind === "qa" ? card.back || card.front : card.front);
  const due = isDue(card);

  return (
    <button
      onClick={() => onOpen(card)}
      className={cn(
        "card-surface w-full p-4 text-left transition active:scale-[.985]",
        due && "border-brand/40",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={cn("chip", style.chip)}>{style.label}</span>
        {due && <span className="chip bg-brand text-white">Due</span>}
        {card.deck && <span className="chip bg-raised text-muted">{card.deck}</span>}
        <span className="ml-auto shrink-0 text-xs text-muted">{timeAgo(card.updated)}</span>
        {card.starred && <Star className="h-4 w-4 shrink-0 fill-accent text-accent" />}
      </div>

      <h3 className="clamp-2 text-[15px] font-bold leading-snug">{card.title}</h3>

      {preview && preview !== card.title && (
        <p className="clamp-2 mt-1 text-sm leading-relaxed text-muted">{preview}</p>
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
  );
}
