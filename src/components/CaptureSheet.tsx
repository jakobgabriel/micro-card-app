/**
 * The capture editor — the screen this app lives or dies by.
 *
 * Design rules applied here:
 *  - Text first. The cursor is in the text box before anything else loads.
 *  - Nothing is required except the text. Type, hit Save, done.
 *  - Everything optional (kind, answer, deck, tags) is one tap away, never
 *    in the way.
 *  - Drafts survive an accidental close, a phone call, or a crash.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Bold,
  BookOpen,
  Code,
  Combine,
  Hash,
  Heading,
  Italic,
  Lightbulb,
  Link2,
  List,
  ListTodo,
  Quote,
  StickyNote,
  Trash2,
} from "lucide-react";

import { Sheet } from "./Sheet";
import { Button, Chip, SegmentedControl } from "./ui";
import { useToast } from "./Toast";
import { api, errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Card, CardKind, Similar } from "@/lib/types";
import { cn, extractInlineTags, prefixLines, wrapSelection } from "@/lib/utils";

const DRAFT_KEY = "micro-card-draft-v1";

const KIND_OPTIONS: { value: CardKind; label: string; icon: JSX.Element }[] = [
  { value: "note", label: "Note", icon: <StickyNote className="h-4 w-4" /> },
  { value: "qa", label: "Q & A", icon: <BookOpen className="h-4 w-4" /> },
  { value: "idea", label: "Idea", icon: <Lightbulb className="h-4 w-4" /> },
  { value: "quote", label: "Quote", icon: <Quote className="h-4 w-4" /> },
  { value: "task", label: "To-do", icon: <ListTodo className="h-4 w-4" /> },
];

const PLACEHOLDERS: Record<CardKind, string> = {
  note: "What do you want to remember?",
  qa: "Ask the question you want to be able to answer…",
  idea: "What is the idea?",
  quote: "Paste the quote, then add who said it.",
  task: "What needs doing?",
};

interface CaptureSheetProps {
  open: boolean;
  onClose: () => void;
  /** Editing an existing card instead of capturing a new one. */
  editing?: Card | null;
  /** Text handed in from elsewhere — the Android share sheet, usually. */
  initialText?: string;
}

export function CaptureSheet({ open, onClose, editing, initialText }: CaptureSheetProps) {
  const { library, saveCard, mergeCards } = useStore();
  const toast = useToast();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const backRef = useRef<HTMLTextAreaElement>(null);
  const [activeField, setActiveField] = useState<"front" | "back">("front");

  const [kind, setKind] = useState<CardKind>("note");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [deck, setDeck] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [showExtras, setShowExtras] = useState(false);
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState<Similar[]>([]);
  const [merging, setMerging] = useState(false);

  const decks = useMemo(
    () =>
      [...new Set((library?.cards ?? []).map((c) => c.deck).filter(Boolean))] as string[],
    [library],
  );
  const suggestedTags = useMemo(
    () =>
      (library?.stats.tags ?? [])
        .map((t) => t.name)
        .filter((t) => t !== library?.settings.default_tag)
        .slice(0, 8),
    [library],
  );

  // Load the card being edited, text shared in from another app, or an
  // unsaved draft — in that order of precedence.
  useEffect(() => {
    if (!open) return;
    if (initialText !== undefined && !editing) {
      setKind("note");
      setFront(initialText);
      setBack("");
      setDeck("");
      setTags([]);
      setShowExtras(false);
      return;
    }
    if (editing) {
      setKind(editing.kind);
      setFront(editing.front);
      setBack(editing.back);
      setDeck(editing.deck ?? "");
      setTags(editing.tags.filter((t) => t !== library?.settings.default_tag));
      setShowExtras(Boolean(editing.deck) || editing.tags.length > 1);
      return;
    }
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        setKind(draft.kind ?? "note");
        setFront(draft.front ?? "");
        setBack(draft.back ?? "");
        setDeck(draft.deck ?? "");
        setTags(draft.tags ?? []);
        return;
      }
    } catch {
      // A broken draft must never block capturing.
    }
    setKind("note");
    setFront("");
    setBack("");
    setDeck("");
    setTags([]);
    setShowExtras(false);
  }, [open, editing, initialText, library?.settings.default_tag]);

  // Keep the draft warm while typing so nothing is ever lost.
  useEffect(() => {
    if (!open || editing || initialText !== undefined) return;
    const id = setTimeout(() => {
      try {
        if (front.trim() || back.trim()) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ kind, front, back, deck, tags }));
        } else {
          localStorage.removeItem(DRAFT_KEY);
        }
      } catch {
        // Storage full or blocked — carry on, the card is still in the box.
      }
    }, 400);
    return () => clearTimeout(id);
  }, [open, editing, initialText, kind, front, back, deck, tags]);

  useEffect(() => {
    if (!open) return;
    // Autofocus after the sheet animation so the keyboard does not fight it.
    const id = setTimeout(() => textRef.current?.focus(), 260);
    return () => clearTimeout(id);
  }, [open]);

  // Look for a card that already says this. Debounced, and never blocking:
  // it is a note above the Save button, not a dialog in the way.
  useEffect(() => {
    if (!open || front.trim().length < 20) {
      setSimilar([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .findSimilar(`${front} ${back}`, editing?.id)
        .then(setSimilar)
        .catch(() => setSimilar([]));
    }, 600);
    return () => clearTimeout(timer);
  }, [open, front, back, editing?.id]);

  /**
   * Apply a Markdown format to whichever box the cursor is in. The point of
   * the toolbar is that nobody has to know what `**` means.
   */
  const format = useCallback(
    (action: FormatAction) => {
      const el = activeField === "back" ? backRef.current : textRef.current;
      if (!el) return;
      const result =
        action.prefix !== undefined
          ? prefixLines(el, action.prefix)
          : wrapSelection(el, action.before ?? "", action.after ?? action.before ?? "");
      if (activeField === "back") setBack(result.text);
      else setFront(result.text);
      // Put the cursor back where the user expects it to be.
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(result.cursor, result.cursor);
      });
    },
    [activeField],
  );

  const inlineTags = useMemo(() => extractInlineTags(`${front} ${back}`), [front, back]);
  const allTags = useMemo(
    () => [...new Set([...tags, ...inlineTags])],
    [tags, inlineTags],
  );
  const canSave = front.trim().length > 0 && !saving;

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/^#/, "").replace(/\s+/g, "-");
    if (!tag) return;
    setTags((current) => (current.includes(tag) ? current : [...current, tag]));
    setTagDraft("");
  };

  /**
   * Fold the look-alikes into the card being edited. Only offered while
   * editing: merging something that has not been saved yet would mean saving
   * it first, which is a surprising thing for a button to do.
   */
  const mergeWithSimilar = async () => {
    if (!editing) return;
    setMerging(true);
    try {
      const { undo } = await mergeCards(
        editing.id,
        similar.map((hit) => hit.id),
      );
      toast.success(
        `Merged ${similar.length} card${similar.length === 1 ? "" : "s"} in`,
        { label: "Undo", run: () => void undo() },
      );
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setMerging(false);
    }
  };

  const submit = async (keepOpen: boolean) => {
    if (!canSave) return;
    setSaving(true);
    try {
      await saveCard({
        id: editing?.id,
        kind,
        front,
        back: kind === "qa" ? back : "",
        deck: deck.trim() || null,
        tags: allTags,
      });
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // Nothing to clean up.
      }
      toast.success(editing ? "Card updated" : "Card saved");
      if (keepOpen) {
        setFront("");
        setBack("");
        textRef.current?.focus();
      } else {
        onClose();
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="full"
      title={editing ? "Edit card" : "New card"}
      footer={
        <div className="flex gap-2">
          {!editing && (
            <Button
              variant="secondary"
              size="lg"
              disabled={!canSave}
              onClick={() => void submit(true)}
              className="shrink-0 whitespace-nowrap px-4 text-sm"
            >
              Save & new
            </Button>
          )}
          <Button
            size="lg"
            block
            loading={saving}
            disabled={!canSave}
            onClick={() => void submit(false)}
          >
            {editing ? "Save changes" : "Save card"}
          </Button>
        </div>
      }
    >
      <SegmentedControl
        className="pb-3 pt-1"
        options={KIND_OPTIONS}
        value={kind}
        onChange={setKind}
      />

      <textarea
        ref={textRef}
        value={front}
        onChange={(e) => setFront(e.target.value)}
        onFocus={() => setActiveField("front")}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit(false);
        }}
        placeholder={PLACEHOLDERS[kind]}
        rows={kind === "qa" ? 4 : 9}
        className={cn(
          "w-full resize-none rounded-2xl border border-line bg-raised p-4",
          "text-[17px] leading-relaxed outline-none placeholder:text-muted/70",
          "focus:border-brand focus:ring-2 focus:ring-brand/20",
        )}
      />

      <FormatBar onFormat={format} />

      {kind === "qa" && (
        <>
          <p className="px-1 pb-1.5 pt-3 text-xs font-bold uppercase tracking-wide text-muted">
            Answer
          </p>
          <textarea
            ref={backRef}
            value={back}
            onChange={(e) => setBack(e.target.value)}
            onFocus={() => setActiveField("back")}
            placeholder="…and the answer you want to recall."
            rows={4}
            className={cn(
              "w-full resize-none rounded-2xl border border-line bg-raised p-4",
              "text-[17px] leading-relaxed outline-none placeholder:text-muted/70",
              "focus:border-brand focus:ring-2 focus:ring-brand/20",
            )}
          />
        </>
      )}

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-3">
          {allTags.map((tag) => {
            const fromText = inlineTags.includes(tag);
            return (
              <Chip
                key={tag}
                className="bg-brand-soft text-brand"
                onClick={
                  fromText ? undefined : () => setTags((c) => c.filter((t) => t !== tag))
                }
              >
                #{tag}
                {!fromText && <Trash2 className="h-3 w-3" />}
              </Chip>
            );
          })}
        </div>
      )}

      {!showExtras ? (
        <button
          onClick={() => setShowExtras(true)}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-semibold text-muted active:bg-raised"
        >
          <Hash className="h-4 w-4" />
          Add tags or a deck
        </button>
      ) : (
        <div className="mt-4 space-y-4 animate-fade-in">
          <div>
            <label className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
              Tags
            </label>
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === " ") {
                  e.preventDefault();
                  addTag(tagDraft);
                }
              }}
              onBlur={() => addTag(tagDraft)}
              placeholder="physics, to-read…"
              className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
            />
            {suggestedTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestedTags
                  .filter((t) => !allTags.includes(t))
                  .map((tag) => (
                    <Chip key={tag} onClick={() => addTag(tag)}>
                      #{tag}
                    </Chip>
                  ))}
              </div>
            )}
          </div>

          <div>
            <label className="px-1 text-xs font-bold uppercase tracking-wide text-muted">
              Deck
            </label>
            <input
              value={deck}
              onChange={(e) => setDeck(e.target.value)}
              placeholder="Inbox"
              list="deck-options"
              className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
            />
            <datalist id="deck-options">
              {decks.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
            {decks.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {decks.slice(0, 6).map((d) => (
                  <Chip key={d} active={deck === d} onClick={() => setDeck(d)}>
                    {d}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {similar.length > 0 && (
        <div className="mt-4 rounded-2xl border border-warn/40 bg-warn/10 p-3.5 animate-fade-in">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">You may already have this</p>
              <ul className="mt-1 space-y-0.5 text-muted">
                {similar.map((hit) => (
                  <li key={hit.id} className="truncate">
                    {hit.title}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {editing && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 w-full"
              loading={merging}
              onClick={() => void mergeWithSimilar()}
              icon={<Combine className="h-4 w-4" />}
            >
              Merge into one card
            </Button>
          )}
        </div>
      )}

      <p className="px-1 py-4 text-xs leading-relaxed text-muted">
        Saved as a Markdown file in{" "}
        <span className="font-mono text-[11px]">{library?.vault_root ?? "your vault"}</span>
        {kind === "qa" && " — question and answer split by a ? line, so Obsidian's spaced repetition plugin reads it too."}
      </p>
    </Sheet>
  );
}

/** One button on the formatting bar. */
interface FormatAction {
  /** Wrap the selection, e.g. `**` for bold. */
  before?: string;
  after?: string;
  /** Or prefix whole lines, e.g. `- ` for a list. */
  prefix?: string;
}

const FORMATS: { label: string; icon: JSX.Element; action: FormatAction }[] = [
  { label: "Bold", icon: <Bold className="h-4 w-4" />, action: { before: "**" } },
  { label: "Italic", icon: <Italic className="h-4 w-4" />, action: { before: "_" } },
  { label: "Heading", icon: <Heading className="h-4 w-4" />, action: { prefix: "# " } },
  { label: "List", icon: <List className="h-4 w-4" />, action: { prefix: "- " } },
  { label: "Quote", icon: <Quote className="h-4 w-4" />, action: { prefix: "> " } },
  { label: "Code", icon: <Code className="h-4 w-4" />, action: { before: "`" } },
  {
    label: "Link to another card",
    icon: <Link2 className="h-4 w-4" />,
    action: { before: "[[", after: "]]" },
  },
];

/**
 * Formatting without knowing Markdown. The bar sits under the text box rather
 * than above it, where a phone keyboard would cover it.
 */
function FormatBar({ onFormat }: { onFormat: (action: FormatAction) => void }) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto pt-2">
      {FORMATS.map((item) => (
        <button
          key={item.label}
          aria-label={item.label}
          title={item.label}
          // Keep the caret in the text box: losing focus would lose the
          // selection the format is meant to apply to.
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          onClick={() => onFormat(item.action)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-raised text-muted transition active:scale-90 active:bg-line"
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}
