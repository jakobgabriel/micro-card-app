import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import type { Card, CardKind } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "just now", "12 min ago", "3 days ago" — no library, no locale surprises. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  const units: [number, string][] = [
    [60, "min"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
    [2629800, "month"],
    [31557600, "year"],
  ];
  let value = seconds;
  let label = "sec";
  for (let i = units.length - 1; i >= 0; i--) {
    const [size, name] = units[i];
    if (seconds >= size) {
      value = Math.round(seconds / size);
      label = name;
      break;
    }
  }
  return `${value} ${label}${value === 1 ? "" : "s"} ago`;
}

/** How long until a card comes back, phrased for the review buttons. */
export function untilDue(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(diff)) return "";
  if (diff <= 60_000) return "now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} d`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} mo`;
  return `${Math.round(days / 365)} y`;
}

export function isDue(card: Card): boolean {
  return card.kind === "qa" && new Date(card.review.due).getTime() <= Date.now();
}

/**
 * Forgiving search: every whitespace-separated term must appear somewhere in
 * the card. `#tag` restricts to tags and `deck:name` to a deck, but plain
 * words are all most people ever type.
 */
export function searchCards(cards: Card[], query: string): Card[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return cards;
  return cards.filter((card) => {
    const haystack = [
      card.title,
      card.front,
      card.back,
      card.deck ?? "",
      card.tags.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => {
      if (term.startsWith("#")) {
        const tag = term.slice(1);
        return card.tags.some((t) => t.toLowerCase().includes(tag));
      }
      if (term.startsWith("deck:")) {
        return (card.deck ?? "inbox").toLowerCase().includes(term.slice(5));
      }
      return haystack.includes(term);
    });
  });
}

/** Colour + label per card kind, used by the tile and the editor. */
export const KIND_STYLE: Record<
  CardKind,
  { label: string; chip: string; dot: string }
> = {
  note: {
    label: "Note",
    chip: "bg-brand-soft text-brand",
    dot: "bg-brand",
  },
  qa: {
    label: "Q & A",
    chip: "bg-good/15 text-good",
    dot: "bg-good",
  },
  idea: {
    label: "Idea",
    chip: "bg-accent/15 text-accent",
    dot: "bg-accent",
  },
  quote: {
    label: "Quote",
    chip: "bg-muted/20 text-muted",
    dot: "bg-muted",
  },
  task: {
    label: "To-do",
    chip: "bg-warn/15 text-warn",
    dot: "bg-warn",
  },
};

/** Short vibration for meaningful actions. Silently ignored where absent. */
export function haptic(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Vibration is a nicety, never a requirement.
  }
}

/** Strip the noisiest Markdown so previews read like plain text. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .trim();
}

/** Tags typed inline in the text, so the editor can show them as chips. */
export function extractInlineTags(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/(^|\s)#([\w/-]+)/g)) {
    const tag = match[2];
    if (/[a-zA-Z]/.test(tag) && !out.includes(tag)) out.push(tag);
  }
  return out;
}
