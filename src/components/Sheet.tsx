/**
 * Bottom sheet. Mobile users expect to dismiss by dragging down or tapping the
 * backdrop, and Android's back button must close it rather than leave the app.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";

import { IconButton } from "./ui";
import { cn, haptic } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Rendered at the bottom, outside the scroll area (e.g. a Save button). */
  footer?: ReactNode;
  children: ReactNode;
  /** Full height for editors, auto height for short confirmations. */
  size?: "auto" | "full";
}

export function Sheet({ open, onClose, title, footer, children, size = "auto" }: SheetProps) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    else {
      // Let the exit animation finish before unmounting.
      const timer = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Trap the Android back gesture: push a history entry we can pop.
    window.history.pushState({ sheet: true }, "");
    const onPop = () => onClose();
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setDragY(0);
  }, [open]);

  if (!mounted) return null;

  const close = () => {
    haptic(8);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="Close"
        onClick={close}
        className={cn(
          "absolute inset-0 bg-black/50 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined }}
        className={cn(
          "relative flex flex-col rounded-t-3xl border-t border-line bg-surface shadow-lift",
          size === "full" ? "h-[92%]" : "max-h-[88%]",
          open ? "animate-slide-up" : "translate-y-full transition-transform duration-200",
        )}
      >
        {/* Drag handle: also the affordance that says "you can pull this down". */}
        <div
          className="shrink-0 cursor-grab touch-none px-4 pb-1 pt-3"
          onTouchStart={(e) => {
            startY.current = e.touches[0].clientY;
          }}
          onTouchMove={(e) => {
            if (startY.current === null) return;
            setDragY(Math.max(0, e.touches[0].clientY - startY.current));
          }}
          onTouchEnd={() => {
            if (dragY > 110) close();
            setDragY(0);
            startY.current = null;
          }}
        >
          <div className="mx-auto h-1.5 w-11 rounded-full bg-line" />
        </div>

        {title && (
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2">
            <h2 className="truncate text-lg font-bold">{title}</h2>
            <IconButton label="Close" onClick={close}>
              <X className="h-5 w-5" />
            </IconButton>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2">
          {children}
        </div>

        {footer && (
          <div className="shrink-0 border-t border-line bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
