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
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Hash, Lightbulb, ListTodo, Quote, StickyNote, Trash2 } from "lucide-react";

import { Sheet } from "./Sheet";
import { Button, Chip, SegmentedControl } from "./ui";
import { useToast } from "./Toast";
import { errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Card, CardKind } from "@/lib/types";
import { cn, extractInlineTags } from "@/lib/utils";

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
}

export function CaptureSheet({ open, onClose, editing }: CaptureSheetProps) {
  const { library, saveCard } = useStore();
  const toast = useToast();
  const textRef = useRef<HTMLTextAreaElement>(null);

  const [kind, setKind] = useState<CardKind>("note");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [deck, setDeck] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [showExtras, setShowExtras] = useState(false);
  const [saving, setSaving] = useState(false);

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

  // Load either the card being edited or an unsaved draft.
  useEffect(() => {
    if (!open) return;
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
  }, [open, editing, library?.settings.default_tag]);

  // Keep the draft warm while typing so nothing is ever lost.
  useEffect(() => {
    if (!open || editing) return;
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
  }, [open, editing, kind, front, back, deck, tags]);

  useEffect(() => {
    if (!open) return;
    // Autofocus after the sheet animation so the keyboard does not fight it.
    const id = setTimeout(() => textRef.current?.focus(), 260);
    return () => clearTimeout(id);
  }, [open]);

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

      {kind === "qa" && (
        <>
          <p className="px-1 pb-1.5 pt-3 text-xs font-bold uppercase tracking-wide text-muted">
            Answer
          </p>
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
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

      <p className="px-1 py-4 text-xs leading-relaxed text-muted">
        Saved as a Markdown file in{" "}
        <span className="font-mono text-[11px]">{library?.vault_root ?? "your vault"}</span>
        {kind === "qa" && " — question and answer split by a ? line, so Obsidian's spaced repetition plugin reads it too."}
      </p>
    </Sheet>
  );
}
