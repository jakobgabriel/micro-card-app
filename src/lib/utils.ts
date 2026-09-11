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

/**
 * Colour + label per card kind. In a green system the brand colour is already
 * green, so Q & A gets the teal `info` token rather than another green — the
 * two must stay distinguishable at a glance in a list.
 */
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
    chip: "bg-info/15 text-info",
    dot: "bg-info",
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
    // Embedded attachments are not worth showing as text in a preview.
    .replace(/!\[\[[^\]]+\]\]/g, " ")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
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

/** `2026-09-11` -> `11 Sep`, for chart labels. */
export function shortDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Is this ISO date today, in the viewer's own timezone? */
export function isToday(iso: string): boolean {
  const date = new Date(`${iso}T00:00:00`);
  return date.toDateString() === new Date().toDateString();
}

/**
 * Resolve a `[[wikilink]]` to a card. Obsidian matches on the note name, so
 * the file name is tried first and the title second.
 */
export function resolveLink(cards: Card[], target: string): Card | undefined {
  const wanted = target.trim().toLowerCase();
  return (
    cards.find(
      (card) =>
        card.path
          .split("/")
          .pop()
          ?.replace(/\.md$/, "")
          .toLowerCase() === wanted,
    ) ?? cards.find((card) => card.title.toLowerCase() === wanted)
  );
}

/** Cards whose text links to this one — the other half of a wikilink. */
export function backlinks(cards: Card[], card: Card): Card[] {
  const names = new Set(
    [card.title, card.path.split("/").pop()?.replace(/\.md$/, "") ?? ""]
      .filter(Boolean)
      .map((n) => n.toLowerCase()),
  );
  return cards.filter(
    (other) =>
      other.id !== card.id &&
      other.links.some((link) => names.has(link.trim().toLowerCase())),
  );
}

/** Insert Markdown around the current selection of a textarea. */
export function wrapSelection(
  el: HTMLTextAreaElement,
  before: string,
  after = before,
): { text: string; cursor: number } {
  const { selectionStart: start, selectionEnd: end, value } = el;
  const selected = value.slice(start, end);
  const text = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`;
  // With nothing selected, drop the cursor between the markers.
  const cursor = selected ? end + before.length + after.length : start + before.length;
  return { text, cursor };
}

/** Prefix every selected line, for lists and quotes. */
export function prefixLines(
  el: HTMLTextAreaElement,
  prefix: string,
): { text: string; cursor: number } {
  const { selectionStart: start, selectionEnd: end, value } = el;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", end);
  const sliceEnd = lineEnd === -1 ? value.length : lineEnd;
  const block = value.slice(lineStart, sliceEnd);
  const updated = block
    .split("\n")
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line))
    .join("\n");
  return {
    text: value.slice(0, lineStart) + updated + value.slice(sliceEnd),
    cursor: lineStart + updated.length,
  };
}

/**
 * Is the caret sitting inside an unfinished `[[wikilink]]`?
 *
 * Returns the text typed so far and where the `[[` started, so the editor can
 * offer matching cards and replace the right span when one is picked.
 */
export function pendingLink(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start === -1) return null;
  // Already closed, or the caret moved past the link.
  const between = before.slice(start + 2);
  if (between.includes("]]") || between.includes("\n")) return null;
  return { query: between, start };
}

/** Rank cards for the link picker: title matches first, then anything else. */
export function suggestLinks(cards: Card[], query: string, limit = 6): Card[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return cards.slice(0, limit);
  const scored = cards
    .map((card) => {
      const title = card.title.toLowerCase();
      if (title.startsWith(needle)) return { card, score: 0 };
      if (title.includes(needle)) return { card, score: 1 };
      if (card.front.toLowerCase().includes(needle)) return { card, score: 2 };
      return null;
    })
    .filter((hit): hit is { card: Card; score: number } => hit !== null);
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((hit) => hit.card);
}

/** The name a `[[wikilink]]` should use for a card: its file name. */
export function linkNameFor(card: Card): string {
  return card.path.split("/").pop()?.replace(/\.md$/, "") || card.title;
}
