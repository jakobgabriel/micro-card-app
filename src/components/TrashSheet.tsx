/**
 * Recently deleted cards.
 *
 * The undo toast covers the mistake you notice immediately; this covers the
 * one you notice on Thursday. Deleted cards sit in the vault's `.trash`, the
 * same folder Obsidian uses, so nothing here is a second copy.
 */
import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2, Undo2 } from "lucide-react";

import { Sheet } from "./Sheet";
import { Button, EmptyState, IconButton, Spinner } from "./ui";
import { useToast } from "./Toast";
import { api, errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { TrashedCard } from "@/lib/types";
import { KIND_STYLE, cn, timeAgo } from "@/lib/utils";

export function TrashSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { reload } = useStore();
  const toast = useToast();
  const [items, setItems] = useState<TrashedCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.listTrash());
    } catch (err) {
      toast.error(errorMessage(err));
      setItems([]);
    }
  }, [toast]);

  useEffect(() => {
    if (open) {
      setConfirming(false);
      void load();
    }
    // `load` is stable enough for a one-shot fetch when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const restore = async (item: TrashedCard) => {
    setBusy(true);
    try {
      await api.restoreCard(item.path);
      await reload();
      await load();
      toast.success(`“${item.title}” is back`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const destroy = async (item: TrashedCard) => {
    setBusy(true);
    try {
      setItems(await api.deleteForever(item.path));
      toast.success("Deleted for good");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const emptyAll = async () => {
    setBusy(true);
    try {
      const removed = await api.emptyTrash();
      setItems([]);
      setConfirming(false);
      toast.success(`${removed} card${removed === 1 ? "" : "s"} deleted for good`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const count = items?.length ?? 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="full"
      title="Recently deleted"
      footer={
        count > 0 ? (
          confirming ? (
            <div className="flex gap-2">
              <Button variant="secondary" size="lg" block onClick={() => setConfirming(false)}>
                Keep them
              </Button>
              <Button
                variant="danger"
                size="lg"
                block
                loading={busy}
                onClick={() => void emptyAll()}
              >
                Delete {count} for good
              </Button>
            </div>
          ) : (
            <Button
              variant="danger"
              size="lg"
              block
              onClick={() => setConfirming(true)}
              icon={<Trash2 className="h-4 w-4" />}
            >
              Empty trash
            </Button>
          )
        ) : undefined
      }
    >
      {items === null ? (
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      ) : count === 0 ? (
        <EmptyState
          icon={<Trash2 className="h-7 w-7" />}
          title="Nothing deleted"
          description="Cards you delete wait here until you empty the trash, so a mistake is never final."
        />
      ) : (
        <>
          <p className="pb-3 text-sm leading-relaxed text-muted">
            These files sit in your vault's <span className="font-mono">.trash</span>{" "}
            folder — the same place Obsidian puts deleted notes.
          </p>
          <div className="space-y-2">
            {items.map((item) => (
              <div key={item.path} className="card-surface flex items-center gap-2 p-3 pl-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("chip", KIND_STYLE[item.kind].chip)}>
                      {KIND_STYLE[item.kind].label}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {timeAgo(item.deleted_at)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-semibold">{item.title}</p>
                  {item.preview && item.preview !== item.title && (
                    <p className="truncate text-sm text-muted">{item.preview}</p>
                  )}
                </div>
                <IconButton
                  label={`Restore ${item.title}`}
                  tone="brand"
                  disabled={busy}
                  onClick={() => void restore(item)}
                >
                  <Undo2 className="h-5 w-5" />
                </IconButton>
                <IconButton
                  label={`Delete ${item.title} for good`}
                  tone="danger"
                  disabled={busy}
                  onClick={() => void destroy(item)}
                >
                  <Trash2 className="h-5 w-5" />
                </IconButton>
              </div>
            ))}
          </div>
          <button
            onClick={() => void load()}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-sm font-semibold text-muted active:bg-raised"
          >
            <RotateCcw className="h-4 w-4" />
            Refresh
          </button>
        </>
      )}
    </Sheet>
  );
}
