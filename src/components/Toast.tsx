/**
 * Toasts double as the undo mechanism: destructive actions never ask "are you
 * sure?", they just happen and offer a way back.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, Undo2 } from "lucide-react";

import { cn, haptic } from "@/lib/utils";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

interface ToastApi {
  show: (message: string, options?: { tone?: ToastTone; action?: Toast["action"] }) => void;
  success: (message: string, action?: Toast["action"]) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-good" />,
  error: <AlertCircle className="h-5 w-5 text-danger" />,
  info: <Info className="h-5 w-5 text-brand" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastApi["show"]>(
    (message, options) => {
      const id = nextId.current++;
      const toast: Toast = {
        id,
        message,
        tone: options?.tone ?? "info",
        action: options?.action,
      };
      setToasts((current) => [...current.slice(-2), toast]);
      haptic(options?.tone === "error" ? [10, 40, 10] : 10);
      // Undo needs longer than a plain confirmation.
      setTimeout(() => dismiss(id), toast.action ? 6000 : 3200);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, action) => show(message, { tone: "success", action }),
      error: (message) => show(message, { tone: "error" }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(9.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line",
              "bg-surface px-4 py-3 shadow-lift animate-pop-in",
            )}
          >
            {ICONS[toast.tone]}
            <p className="flex-1 text-sm font-medium leading-snug">{toast.message}</p>
            {toast.action && (
              <button
                onClick={() => {
                  toast.action?.run();
                  dismiss(toast.id);
                }}
                className="flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1.5 text-sm font-bold text-brand active:scale-95"
              >
                <Undo2 className="h-4 w-4" />
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
