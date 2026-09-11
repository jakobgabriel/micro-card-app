import { useState } from "react";
import {
  CalendarClock,
  ExternalLink,
  FileText,
  Link2,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";

import { Markdown } from "./Markdown";
import { Sheet } from "./Sheet";
import { Button, IconButton } from "./ui";
import { useToast } from "./Toast";
import { api, errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Card } from "@/lib/types";
import {
  KIND_STYLE,
  backlinks,
  cn,
  isDue,
  resolveLink,
  timeAgo,
  untilDue,
} from "@/lib/utils";

interface Props {
  card: Card | null;
  onClose: () => void;
  onEdit: (card: Card) => void;
  /** Open another card, for wikilinks and backlinks. */
  onOpen: (card: Card) => void;
}

export function CardDetailSheet({ card, onClose, onEdit, onOpen }: Props) {
  const { library, deleteCard, saveCard } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!card) return null;
  const style = KIND_STYLE[card.kind];
  const cards = library?.cards ?? [];
  const linkedFrom = backlinks(cards, card);

  /** Follow a `[[wikilink]]`; offer to create the card when it does not exist. */
  const followLink = (target: string) => {
    const match = resolveLink(cards, target);
    if (match) {
      onOpen(match);
    } else {
      toast.show(`No card called “${target}” yet.`, { tone: "info" });
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const { undo } = await deleteCard(card.id);
      onClose();
      toast.success("Card moved to trash", {
        label: "Undo",
        run: () => {
          void undo();
        },
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleStar = async () => {
    try {
      await saveCard({
        id: card.id,
        front: card.front,
        back: card.back,
        starred: !card.starred,
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const openInObsidian = async () => {
    try {
      const uri = await api.obsidianUri(card.id);
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(uri);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Sheet
      open={Boolean(card)}
      onClose={onClose}
      size="full"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" onClick={() => onEdit(card)} block icon={<Pencil className="h-4 w-4" />}>
            Edit
          </Button>
          <Button
            variant="danger"
            size="lg"
            loading={busy}
            onClick={() => void remove()}
            aria-label="Delete card"
            className="w-14 px-0"
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>
      }
    >
      <div className="flex items-center gap-2 pb-3">
        <span className={cn("chip", style.chip)}>{style.label}</span>
        {card.deck && <span className="chip bg-raised text-muted">{card.deck}</span>}
        <IconButton
          label={card.starred ? "Remove star" : "Star card"}
          tone={card.starred ? "brand" : "default"}
          className="ml-auto"
          onClick={() => void toggleStar()}
        >
          <Star className={cn("h-5 w-5", card.starred && "fill-accent text-accent")} />
        </IconButton>
      </div>

      <Markdown text={card.front} onLink={followLink} />

      {card.kind === "qa" && card.back && (
        <>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              Answer
            </span>
            <div className="h-px flex-1 bg-line" />
          </div>
          <Markdown text={card.back} onLink={followLink} />
        </>
      )}

      {card.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-5">
          {card.tags.map((tag) => (
            <span key={tag} className="chip bg-brand-soft text-brand">
              #{tag}
            </span>
          ))}
        </div>
      )}

      {linkedFrom.length > 0 && (
        <div className="mt-6">
          <p className="flex items-center gap-1.5 px-1 pb-2 text-xs font-bold uppercase tracking-wide text-muted">
            <Link2 className="h-3.5 w-3.5" />
            Linked from
          </p>
          <div className="space-y-1.5">
            {linkedFrom.map((other) => (
              <button
                key={other.id}
                onClick={() => onOpen(other)}
                className="flex w-full items-center gap-2 rounded-xl bg-raised px-3 py-2.5 text-left active:scale-[.98]"
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", KIND_STYLE[other.kind].dot)} />
                <span className="truncate text-sm font-medium">{other.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 space-y-2 rounded-2xl bg-raised p-4 text-sm text-muted">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate font-mono text-xs" data-selectable>
            {card.path}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 shrink-0" />
          <span>
            Edited {timeAgo(card.updated)}
            {card.kind === "qa" &&
              ` · ${
                isDue(card) ? "due now" : `back in ${untilDue(card.review.due)}`
              }${card.review.reps > 0 ? ` · ${card.review.reps} reviews` : ""}`}
          </span>
        </div>
        <button
          onClick={() => void openInObsidian()}
          className="flex w-full items-center gap-2 pt-1 text-left font-semibold text-brand active:opacity-70"
        >
          <ExternalLink className="h-4 w-4 shrink-0" />
          Open in Obsidian
        </button>
      </div>
    </Sheet>
  );
}
