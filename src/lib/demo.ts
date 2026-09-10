/**
 * Browser fallback used when the UI runs outside Tauri (`npm run dev` in a
 * normal browser, or the web preview build). It keeps cards in localStorage so
 * every screen is explorable without a vault, and it mirrors the Rust
 * behaviour closely enough that the UI needs no special cases.
 */
import type {
  Card,
  CardDraft,
  Deleted,
  Grade,
  Library,
  Settings,
  Stats,
  VaultCandidate,
} from "./types";

const STORE_KEY = "micro-card-demo-v1";

export function isDemoMode(): boolean {
  return !("__TAURI_INTERNALS__" in window);
}

interface DemoState {
  cards: Card[];
  settings: Settings;
  reviewedToday: number;
  day: string;
}

const defaultSettings: Settings = {
  vault_path: null,
  folder: "Cards",
  default_tag: "card",
  onboarded: false,
  dark_mode: true,
  daily_goal: 20,
};

function seedCards(): Card[] {
  const now = Date.now();
  const iso = (offsetMinutes: number) =>
    new Date(now - offsetMinutes * 60_000).toISOString();
  const base = {
    back: "",
    deck: null as string | null,
    starred: false,
    links: [] as string[],
    review: { due: iso(0), interval: 0, ease: 2.5, reps: 0, lapses: 0 },
  };
  return [
    {
      ...base,
      id: "demo_1",
      kind: "qa",
      title: "What makes a card atomic?",
      front: "What makes a card atomic?",
      back: "It holds exactly one idea — small enough to recall in a breath, complete enough to stand alone.",
      tags: ["card", "method"],
      deck: "Method",
      created: iso(90),
      updated: iso(90),
      path: "Cards/What makes a card atomic.md",
    },
    {
      ...base,
      id: "demo_2",
      kind: "note",
      title: "Capture beats organising",
      front:
        "Capture beats organising.\n\nA thought written down in five seconds is worth more than a perfect folder tree you never fill. Sort later, in [[Obsidian]].",
      tags: ["card", "workflow"],
      deck: "Method",
      created: iso(220),
      updated: iso(220),
      links: ["Obsidian"],
      path: "Cards/Capture beats organising.md",
    },
    {
      ...base,
      id: "demo_3",
      kind: "quote",
      title: "The palest ink beats the best memory",
      front: "The palest ink is better than the best memory.\n\n— Chinese proverb",
      tags: ["card", "quotes"],
      created: iso(1500),
      updated: iso(1500),
      path: "Cards/The palest ink beats the best memory.md",
    },
    {
      ...base,
      id: "demo_4",
      kind: "qa",
      title: "Spaced repetition, in one line?",
      front: "Spaced repetition, in one line?",
      back: "Review each card just before you would have forgotten it.",
      tags: ["card", "method"],
      deck: "Method",
      created: iso(2600),
      updated: iso(2600),
      path: "Cards/Spaced repetition in one line.md",
    },
  ];
}

function load(): DemoState {
  const today = new Date().toDateString();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoState;
      if (parsed.day !== today) {
        parsed.day = today;
        parsed.reviewedToday = 0;
      }
      return parsed;
    }
  } catch {
    // Corrupted or unavailable storage: start fresh rather than break the app.
  }
  return {
    cards: seedCards(),
    settings: { ...defaultSettings },
    reviewedToday: 0,
    day: today,
  };
}

function save(state: DemoState) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Private browsing: the session still works, it just will not persist.
  }
}

function titleFromText(text: string): string {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const cleaned = line.replace(/^[#>*\-+\s]+/, "").trim();
  if (!cleaned) return "Untitled card";
  return cleaned.length > 60 ? `${cleaned.slice(0, 60).trimEnd()}…` : cleaned;
}

function statsFor(state: DemoState): Stats {
  const now = Date.now();
  const today = new Date().toDateString();
  const decks = new Map<string, { count: number; due: number }>();
  const tags = new Map<string, number>();
  let due = 0;
  let capturedToday = 0;

  for (const card of state.cards) {
    const isDue = card.kind === "qa" && new Date(card.review.due).getTime() <= now;
    if (isDue) due += 1;
    if (new Date(card.created).toDateString() === today) capturedToday += 1;
    const deck = card.deck ?? "Inbox";
    const entry = decks.get(deck) ?? { count: 0, due: 0 };
    entry.count += 1;
    if (isDue) entry.due += 1;
    decks.set(deck, entry);
    for (const tag of card.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }

  return {
    total: state.cards.length,
    due,
    captured_today: capturedToday,
    reviewed_today: state.reviewedToday,
    streak_days: state.reviewedToday > 0 || capturedToday > 0 ? 1 : 0,
    decks: [...decks.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count),
    tags: [...tags.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };
}

function library(state: DemoState): Library {
  return {
    cards: [...state.cards].sort(
      (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime(),
    ),
    stats: statsFor(state),
    settings: state.settings,
    vault_root: state.settings.vault_path
      ? `${state.settings.vault_path}/${state.settings.folder}`
      : "Demo storage (browser)",
    local_mode: state.settings.vault_path === null,
  };
}

/** SM-2 lite, mirroring `Review::grade` on the Rust side. */
function gradeReview(card: Card, grade: Grade): Card["review"] {
  const r = { ...card.review };
  if (grade === "again") {
    r.lapses += 1;
    r.reps = 0;
    r.ease = Math.max(1.3, r.ease - 0.2);
    r.interval = 0.007;
  } else if (grade === "good") {
    r.interval = r.reps === 0 ? 1 : r.reps === 1 ? 3 : Math.max(1, r.interval * r.ease);
    r.reps += 1;
  } else {
    r.ease = Math.min(3, r.ease + 0.15);
    r.interval =
      r.reps === 0 ? 3 : r.reps === 1 ? 6 : Math.max(1, r.interval * r.ease * 1.3);
    r.reps += 1;
  }
  r.interval = Math.min(365, r.interval);
  r.due = new Date(Date.now() + Math.max(60, r.interval * 86400) * 1000).toISOString();
  return r;
}

export async function demoInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const state = load();
  const done = <R>(value: R): Promise<R> => {
    save(state);
    return Promise.resolve(value);
  };

  switch (cmd) {
    case "get_library":
    case "refresh_library":
      return done(library(state)) as Promise<T>;

    case "get_settings":
      return done(state.settings) as Promise<T>;

    case "update_settings": {
      const patch = (args?.patch ?? {}) as Partial<Settings>;
      state.settings = { ...state.settings, ...patch };
      return done(library(state)) as Promise<T>;
    }

    case "detect_vaults":
      return done([
        { name: "Demo Vault", path: "/storage/emulated/0/Documents/Demo Vault", note_count: 128 },
      ] as VaultCandidate[]) as Promise<T>;

    case "set_vault":
    case "move_local_cards_to_vault": {
      const choice = args?.choice as { path: string; folder?: string };
      state.settings.vault_path = choice.path;
      if (choice.folder) state.settings.folder = choice.folder;
      state.settings.onboarded = true;
      return done(library(state)) as Promise<T>;
    }

    case "use_local_vault":
      state.settings.vault_path = null;
      state.settings.onboarded = true;
      return done(library(state)) as Promise<T>;

    case "save_card": {
      const draft = args?.draft as CardDraft;
      const now = new Date().toISOString();
      const existing = state.cards.find((c) => c.id === draft.id);
      const tags = [...(draft.tags ?? existing?.tags ?? [])];
      if (state.settings.default_tag && !tags.includes(state.settings.default_tag)) {
        tags.push(state.settings.default_tag);
      }
      const kind =
        draft.kind ?? existing?.kind ?? (draft.back?.trim() ? "qa" : "note");
      const card: Card = {
        id: existing?.id ?? `demo_${Date.now().toString(36)}`,
        kind,
        title: draft.title?.trim() || titleFromText(draft.front),
        front: draft.front.trim(),
        back: (draft.back ?? existing?.back ?? "").trim(),
        tags,
        deck: draft.deck ?? existing?.deck ?? null,
        created: existing?.created ?? now,
        updated: now,
        starred: draft.starred ?? existing?.starred ?? false,
        review: existing?.review ?? {
          due: now,
          interval: 0,
          ease: 2.5,
          reps: 0,
          lapses: 0,
        },
        path: existing?.path ?? `Cards/${titleFromText(draft.front)}.md`,
        links: [...draft.front.matchAll(/\[\[([^\]|]+)/g)].map((m) => m[1].trim()),
      };
      state.cards = existing
        ? state.cards.map((c) => (c.id === card.id ? card : c))
        : [card, ...state.cards];
      return done(card) as Promise<T>;
    }

    case "delete_card": {
      const id = args?.id as string;
      const card = state.cards.find((c) => c.id === id);
      state.cards = state.cards.filter((c) => c.id !== id);
      return done({
        id,
        trashed_path: card?.path ?? "",
      } as Deleted) as Promise<T>;
    }

    case "restore_card":
      return done(library(state)) as Promise<T>;

    case "due_cards": {
      const now = Date.now();
      const due = state.cards
        .filter((c) => c.kind === "qa" && new Date(c.review.due).getTime() <= now)
        .sort((a, b) => b.review.lapses - a.review.lapses);
      return done(due) as Promise<T>;
    }

    case "grade_card": {
      const id = args?.id as string;
      const grade = args?.grade as Grade;
      const card = state.cards.find((c) => c.id === id);
      if (!card) throw new Error("Card not found");
      const updated: Card = {
        ...card,
        review: gradeReview(card, grade),
        updated: new Date().toISOString(),
      };
      state.cards = state.cards.map((c) => (c.id === id ? updated : c));
      state.reviewedToday += 1;
      return done(updated) as Promise<T>;
    }

    case "obsidian_uri":
      throw new Error("Connect a vault first to open cards in Obsidian.");

    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}
