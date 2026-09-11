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
  TrashedCard,
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
  lastSynced?: string;
  trash?: TrashedCard[];
}

const defaultSettings: Settings = {
  vault_path: null,
  folder: "Cards",
  default_tag: "card",
  onboarded: false,
  theme: "system",
  text_scale: 1,
  daily_goal: 20,
  session_size: 20,
  reminder_hour: null,
  github: null,
  github_auto_sync: true,
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

/** Mirrors `title_from_text` in `src-tauri/src/markdown.rs`. */
function titleFromText(text: string): string {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const cleaned = line
    // `# ` is a heading marker; `#tag` is metadata and must not become a title.
    .replace(/^#+\s+/, "")
    .replace(/^[>*\-+\s]+/, "")
    .replace(/(^|\s)#[\w/-]*[a-zA-Z][\w/-]*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
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

  const kinds = new Map<string, number>();
  for (const card of state.cards) kinds.set(card.kind, (kinds.get(card.kind) ?? 0) + 1);

  const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const forecast = new Map<string, number>();
  for (const card of state.cards) {
    if (card.kind !== "qa") continue;
    const dueDate = new Date(card.review.due);
    const key = dueDate.getTime() <= now ? day(0) : dueDate.toISOString().slice(0, 10);
    if (key <= day(13)) forecast.set(key, (forecast.get(key) ?? 0) + 1);
  }

  return {
    total: state.cards.length,
    due,
    captured_today: capturedToday,
    reviewed_today: state.reviewedToday,
    streak_days: state.reviewedToday > 0 || capturedToday > 0 ? 1 : 0,
    best_streak: Math.max(1, state.reviewedToday > 0 ? 1 : 0),
    decks: [...decks.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.count - a.count),
    tags: [...tags.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    kinds: [...kinds.entries()]
      .map(([kind, count]) => ({ kind: kind as Card["kind"], count }))
      .sort((a, b) => b.count - a.count),
    activity: Array.from({ length: 84 }, (_, i) => {
      const date = day(i - 83);
      // A plausible-looking history so the chart is not a blank rectangle.
      const seed = (i * 7919) % 11;
      return { date, count: i > 76 ? (i === 83 ? state.reviewedToday : seed % 5) : seed % 4 };
    }),
    forecast: Array.from({ length: 14 }, (_, i) => ({
      date: day(i),
      count: forecast.get(day(i)) ?? 0,
    })),
    retention: state.reviewedToday >= 3 ? 0.86 : null,
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
    attachments_dir: "",
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
      if (card) {
        state.trash = [
          {
            path: `.trash/${card.title}.md`,
            title: card.title,
            kind: card.kind,
            preview: card.front.slice(0, 160),
            deleted_at: new Date().toISOString(),
          },
          ...(state.trash ?? []),
        ];
      }
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

    case "github_status":
      return done({
        connected: state.settings.github !== null,
        repo: state.settings.github
          ? `${state.settings.github.owner}/${state.settings.github.repo}`
          : null,
        branch: state.settings.github?.branch ?? null,
        auto_sync: state.settings.github_auto_sync,
        last_synced: state.lastSynced ?? null,
        last_commit: null,
        tracked_files: state.settings.github ? state.cards.length : 0,
      }) as Promise<T>;

    case "github_connect": {
      const connection = args?.connection as { repo: string; branch?: string };
      const [owner, repo] = connection.repo.replace(/^.*github\.com[:/]/, "").split("/");
      if (!owner || !repo) throw new Error("Use owner/repo, for example octocat/notes.");
      state.settings.github = {
        owner,
        repo: repo.replace(/\.git$/, ""),
        branch: connection.branch || "main",
      };
      state.settings.onboarded = true;
      return done({
        full_name: `${owner}/${repo}`,
        private: true,
        default_branch: "main",
        can_write: true,
        existing_cards: 0,
      }) as Promise<T>;
    }

    case "github_disconnect":
      state.settings.github = null;
      return done(library(state)) as Promise<T>;

    case "sync_now": {
      if (!state.settings.github) throw new Error("No repository is connected yet.");
      state.lastSynced = new Date().toISOString().slice(0, 16).replace("T", " ");
      return done({
        pulled: 0,
        pushed: state.cards.length,
        deleted_local: 0,
        deleted_remote: 0,
        conflicts: [],
        commit: "demo",
        summary: `Synced — ${state.cards.length} out`,
      }) as Promise<T>;
    }

    case "rename_tag": {
      const from = (args?.from as string).replace(/^#/, "");
      const to = (args?.to as string).replace(/^#/, "");
      let changed = 0;
      state.cards = state.cards.map((card) => {
        if (!card.tags.includes(from)) return card;
        changed += 1;
        const tags = card.tags.filter((t) => t !== from);
        if (to && !tags.includes(to)) tags.push(to);
        const swap = (text: string) =>
          text.replace(new RegExp(`(^|\\s)#${from}\\b`, "g"), to ? `$1#${to}` : "$1");
        return { ...card, tags, front: swap(card.front), back: swap(card.back) };
      });
      return done({ changed }) as Promise<T>;
    }

    case "rename_deck": {
      const from = args?.from as string;
      const to = (args?.to as string).trim();
      let changed = 0;
      state.cards = state.cards.map((card) => {
        if ((card.deck ?? "Inbox") !== from) return card;
        changed += 1;
        return { ...card, deck: to && to !== "Inbox" ? to : null };
      });
      return done({ changed }) as Promise<T>;
    }

    case "bulk_edit": {
      const edit = args?.edit as {
        ids: string[];
        add_tags?: string[];
        remove_tags?: string[];
        deck?: string;
        starred?: boolean;
      };
      let changed = 0;
      state.cards = state.cards.map((card) => {
        if (!edit.ids.includes(card.id)) return card;
        changed += 1;
        const tags = [...card.tags.filter((t) => !(edit.remove_tags ?? []).includes(t))];
        for (const tag of edit.add_tags ?? []) if (!tags.includes(tag)) tags.push(tag);
        return {
          ...card,
          tags,
          deck:
            edit.deck === undefined
              ? card.deck
              : edit.deck && edit.deck !== "Inbox"
                ? edit.deck
                : null,
          starred: edit.starred ?? card.starred,
        };
      });
      return done({ changed }) as Promise<T>;
    }

    case "bulk_delete": {
      const ids = args?.ids as string[];
      const removed = state.cards.filter((c) => ids.includes(c.id));
      state.cards = state.cards.filter((c) => !ids.includes(c.id));
      return done(
        removed.map((c) => ({ id: c.id, trashed_path: c.path })) as Deleted[],
      ) as Promise<T>;
    }

    case "restore_many":
      return done(library(state)) as Promise<T>;

    case "review_session": {
      const request = (args?.request ?? {}) as {
        deck?: string | null;
        tag?: string | null;
        cram?: boolean;
        limit?: number;
      };
      const now = Date.now();
      const cards = state.cards
        .filter((c) => c.kind === "qa")
        .filter((c) => request.cram || new Date(c.review.due).getTime() <= now)
        .filter((c) => !request.deck || (c.deck ?? "Inbox") === request.deck)
        .filter((c) => !request.tag || c.tags.includes(request.tag))
        .sort((a, b) => b.review.lapses - a.review.lapses)
        .slice(0, request.limit ?? state.settings.session_size);
      return done(cards) as Promise<T>;
    }

    case "restore_review": {
      const id = args?.id as string;
      const review = args?.review as Card["review"];
      state.cards = state.cards.map((c) => (c.id === id ? { ...c, review } : c));
      state.reviewedToday = Math.max(0, state.reviewedToday - 1);
      return done(state.cards.find((c) => c.id === id)!) as Promise<T>;
    }

    case "find_similar": {
      const words = (text: string) =>
        new Set(
          text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((w) => w.length > 3),
        );
      const target = words(args?.text as string);
      if (target.size < 3) return done([]) as Promise<T>;
      const hits = state.cards
        .filter((c) => c.id !== args?.exclude)
        .map((card) => {
          const other = words(`${card.front} ${card.back}`);
          const shared = [...target].filter((w) => other.has(w)).length;
          const union = target.size + other.size - shared;
          return { id: card.id, title: card.title, score: shared / Math.max(1, union) };
        })
        .filter((hit) => hit.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return done(hits) as Promise<T>;
    }

    case "import_text": {
      const request = args?.request as {
        text: string;
        split?: string;
        deck?: string;
        tags?: string[];
      };
      const chunks =
        request.split === "blocks"
          ? request.text.split("\n\n")
          : request.text.split("\n");
      let created = 0;
      for (const raw of chunks.map((c) => c.trim()).filter(Boolean)) {
        const [front, back] = raw.includes("\t")
          ? raw.split("\t")
          : raw.includes("::")
            ? raw.split("::")
            : [raw, ""];
        const now = new Date().toISOString();
        state.cards.unshift({
          id: `demo_${Date.now().toString(36)}_${created}`,
          kind: back.trim() ? "qa" : "note",
          title: titleFromText(front),
          front: front.trim(),
          back: back.trim(),
          tags: [...(request.tags ?? []), state.settings.default_tag].filter(Boolean),
          deck: request.deck ?? null,
          created: now,
          updated: now,
          starred: false,
          review: { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 },
          path: `Cards/${titleFromText(front)}.md`,
          links: [],
        });
        created += 1;
      }
      return done({ created, skipped: 0 }) as Promise<T>;
    }

    case "export_markdown":
      return done(
        `# Micro Card export\n\n${state.cards
          .map((c) => `### ${c.title}\n\n${c.front}`)
          .join("\n\n")}\n`,
      ) as Promise<T>;

    case "write_text_file":
    case "read_text_file":
      throw new Error("Files are only available in the installed app.");

    case "add_sample_cards": {
      state.cards = [...seedCards(), ...state.cards];
      return done(library(state)) as Promise<T>;
    }

    case "list_trash":
      return done(state.trash ?? []) as Promise<T>;

    case "delete_forever": {
      const path = args?.path as string;
      state.trash = (state.trash ?? []).filter((t) => t.path !== path);
      return done(state.trash) as Promise<T>;
    }

    case "empty_trash": {
      const count = (state.trash ?? []).length;
      state.trash = [];
      return done(count) as Promise<T>;
    }

    case "take_shared_text":
      // A browser preview has no share sheet to receive from.
      return done(null) as Promise<T>;

    case "export_cards": {
      const format = args?.format as string;
      if (format === "json") return done(JSON.stringify(state.cards, null, 2)) as Promise<T>;
      if (format === "csv") {
        const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;
        return done(
          `front,back,tags\n${state.cards
            .map((c) => [quote(c.front), quote(c.back), quote(c.tags.join(" "))].join(","))
            .join("\n")}\n`,
        ) as Promise<T>;
      }
      return done(
        `# Micro Card export\n\n${state.cards
          .map((c) => `### ${c.title}\n\n${c.front}`)
          .join("\n\n")}\n`,
      ) as Promise<T>;
    }

    case "merge_cards": {
      const keep = args?.keep as string;
      const merge = args?.merge as string[];
      const keeper = state.cards.find((c) => c.id === keep);
      if (!keeper) throw new Error("Card not found");
      const others = state.cards.filter((c) => merge.includes(c.id) && c.id !== keep);
      const merged: Card = { ...keeper };
      for (const other of others) {
        for (const tag of other.tags) if (!merged.tags.includes(tag)) merged.tags.push(tag);
        if (other.front.trim() && !merged.front.includes(other.front.trim())) {
          merged.front = `${merged.front.trim()}\n\n${other.front.trim()}`;
        }
        if (other.back.trim() && !merged.back.includes(other.back.trim())) {
          merged.back = merged.back.trim()
            ? `${merged.back.trim()}\n\n${other.back.trim()}`
            : other.back.trim();
        }
        merged.starred = merged.starred || other.starred;
      }
      merged.updated = new Date().toISOString();
      state.trash = [
        ...others.map((o) => ({
          path: `.trash/${o.title}.md`,
          title: o.title,
          kind: o.kind,
          preview: o.front.slice(0, 160),
          deleted_at: new Date().toISOString(),
        })),
        ...(state.trash ?? []),
      ];
      state.cards = state.cards
        .filter((c) => !merge.includes(c.id) || c.id === keep)
        .map((c) => (c.id === keep ? merged : c));
      return done({
        card: merged,
        trashed: others.map((o) => ({ id: o.id, trashed_path: `.trash/${o.title}.md` })),
      }) as Promise<T>;
    }

    case "add_attachment":
      throw new Error("Attaching files needs the installed app.");

    case "unused_attachments":
      return done([]) as Promise<T>;

    case "tidy_attachments":
      return done({ changed: 0 }) as Promise<T>;

    case "resurfaced_card": {
      const now = Date.now();
      const older = state.cards.filter(
        (c) => now - new Date(c.updated).getTime() >= 86_400_000,
      );
      return done(older.length > 0 ? older[0] : null) as Promise<T>;
    }

    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}
