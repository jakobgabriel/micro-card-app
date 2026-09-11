/**
 * Decks and tags, with the two operations people actually need once a
 * collection grows: rename everything at once, and study just this slice.
 */
import { useState } from "react";
import { Hash, Layers, Pencil, Play, Search } from "lucide-react";

import { Button, EmptyState, IconButton } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { useToast } from "@/components/Toast";
import { errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type Tab = "decks" | "tags";

interface Editing {
  kind: Tab;
  name: string;
  count: number;
}

export function Browse({
  onOpenFilter,
  onStudy,
}: {
  /** Show these cards in the library. */
  onOpenFilter: (query: string) => void;
  /** Start a review session limited to this deck or tag. */
  onStudy: (filter: { deck?: string; tag?: string }) => void;
}) {
  const { library, renameTag, renameDeck } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("decks");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);

  const decks = library?.stats.decks ?? [];
  const tags = library?.stats.tags ?? [];

  const startEdit = (kind: Tab, name: string, count: number) => {
    setEditing({ kind, name, count });
    setDraftName(name);
  };

  const commit = async () => {
    if (!editing) return;
    const target = draftName.trim();
    if (!target || target === editing.name) {
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      const changed =
        editing.kind === "tags"
          ? await renameTag(editing.name, target)
          : await renameDeck(editing.name, target);
      toast.success(
        `Renamed on ${changed} card${changed === 1 ? "" : "s"}`,
      );
      setEditing(null);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rows =
    tab === "decks"
      ? decks.map((d) => ({ name: d.name, count: d.count, due: d.due }))
      : tags.map((t) => ({ name: t.name, count: t.count, due: 0 }));

  return (
    <div className="px-4 pb-28 pt-4">
      <header>
        <h1 className="text-2xl font-black">Browse</h1>
        <p className="text-sm text-muted">Decks and tags across every card</p>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-raised p-1">
        {(["decks", "tags"] as Tab[]).map((value) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={cn(
              "h-10 rounded-xl text-sm font-bold capitalize transition",
              tab === value ? "bg-surface text-ink shadow-card" : "text-muted",
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={tab === "decks" ? <Layers className="h-7 w-7" /> : <Hash className="h-7 w-7" />}
          title={tab === "decks" ? "No decks yet" : "No tags yet"}
          description={
            tab === "decks"
              ? "Decks group cards by subject. Add one while capturing, or leave everything in Inbox."
              : "Type #something in a card and the tag appears here."
          }
        />
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <div key={row.name} className="card-surface flex items-center gap-2 p-3 pl-4">
              <button
                onClick={() =>
                  onOpenFilter(tab === "tags" ? `#${row.name}` : `deck:${row.name}`)
                }
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={cn(
                    "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                    "bg-brand-soft text-brand",
                  )}
                >
                  {tab === "decks" ? <Layers className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{row.name}</span>
                  <span className="block text-xs text-muted">
                    {row.count} card{row.count === 1 ? "" : "s"}
                    {row.due > 0 && ` · ${row.due} due`}
                  </span>
                </span>
              </button>

              <IconButton
                label={`Study ${row.name}`}
                tone={row.due > 0 || tab === "tags" ? "brand" : "default"}
                onClick={() =>
                  onStudy(tab === "decks" ? { deck: row.name } : { tag: row.name })
                }
              >
                <Play className="h-4.5 w-4.5" />
              </IconButton>
              <IconButton
                label={`Rename ${row.name}`}
                onClick={() => startEdit(tab, row.name, row.count)}
              >
                <Pencil className="h-4.5 w-4.5" />
              </IconButton>
            </div>
          ))}
        </div>
      )}

      <p className="mt-5 flex items-start gap-2 px-1 text-xs leading-relaxed text-muted">
        <Search className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Tap a row to see its cards, or the play button to review just that
        group — even cards that are not due yet.
      </p>

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.kind === "tags" ? "Rename tag" : "Rename deck"}
        footer={
          <Button size="lg" block loading={busy} onClick={() => void commit()}>
            Rename everywhere
          </Button>
        }
      >
        <p className="pb-3 text-sm leading-relaxed text-muted">
          This updates all {editing?.count} card
          {editing?.count === 1 ? "" : "s"}
          {editing?.kind === "tags"
            ? ", including the #tag written in the text."
            : "."}
        </p>
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          autoFocus
          className="h-12 w-full rounded-2xl border border-line bg-raised px-4 outline-none focus:border-brand"
        />
      </Sheet>
    </div>
  );
}
