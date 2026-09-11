/**
 * Review session. Tap the card to flip it, then grade it — or just swipe:
 * left for "again", right for "good". The buttons show when each answer will
 * come back, so the choice is never a guess.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, PartyPopper, RotateCcw, Sparkles, Undo2, X } from "lucide-react";

import { Markdown } from "@/components/Markdown";
import { Button, EmptyState, IconButton } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { api, errorMessage } from "@/lib/api";
import { useStore } from "@/lib/store";
import type { Card, Grade, Review as ReviewState, SessionRequest } from "@/lib/types";
import { cn, haptic, untilDue } from "@/lib/utils";

const SWIPE_THRESHOLD = 90;

export function Review({
  onExit,
  filter,
}: {
  onExit: () => void;
  /** Set when the session was started from a deck or tag in Browse. */
  filter?: SessionRequest;
}) {
  const { library, gradeCard, restoreReview } = useStore();
  const toast = useToast();

  const [queue, setQueue] = useState<Card[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [drag, setDrag] = useState(0);
  const [exiting, setExiting] = useState<Grade | null>(null);
  const [done, setDone] = useState(0);
  const startX = useRef<number | null>(null);
  /** The card and schedule from the last grade, so one tap can take it back. */
  const lastGrade = useRef<{ id: string; review: ReviewState } | null>(null);

  // Build the queue once, on the backend, so the session does not shift under
  // the user while they work through it.
  useEffect(() => {
    if (queue !== null || !library) return;
    let cancelled = false;
    api
      .reviewSession(filter ?? {})
      .then((cards) => {
        if (!cancelled) setQueue(cards);
      })
      .catch(() => {
        if (!cancelled) setQueue([]);
      });
    return () => {
      cancelled = true;
    };
  }, [library, queue, filter]);

  const current = queue?.[index] ?? null;

  const answer = useCallback(
    async (grade: Grade) => {
      if (!current) return;
      haptic(grade === "again" ? [8, 30, 8] : 14);
      setExiting(grade);
      lastGrade.current = { id: current.id, review: current.review };
      try {
        await gradeCard(current.id, grade);
        setDone((n) => n + 1);
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        // Let the card animate out before the next one lands.
        setTimeout(() => {
          setExiting(null);
          setDrag(0);
          setFlipped(false);
          setIndex((i) => i + 1);
        }, 180);
      }
    },
    [current, gradeCard, toast],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!current) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && ["1", "2", "3"].includes(event.key)) {
        void answer((["again", "good", "easy"] as Grade[])[Number(event.key) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, flipped, answer]);

  const undoLast = async () => {
    const last = lastGrade.current;
    if (!last) return;
    lastGrade.current = null;
    try {
      await restoreReview(last.id, last.review);
      setDone((n) => Math.max(0, n - 1));
      setIndex((i) => Math.max(0, i - 1));
      setFlipped(false);
      toast.success("Put that card back");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  if (queue === null) return null;

  if (queue.length === 0 || !current) {
    const finished = done > 0;
    return (
      <div className="flex h-full flex-col px-4 pb-28 pt-4">
        <Header onExit={onExit} done={done} total={queue.length} />
        <div className="flex flex-1 items-center">
          <EmptyState
            icon={finished ? <PartyPopper className="h-7 w-7" /> : <Sparkles className="h-7 w-7" />}
            title={finished ? "Session complete" : "Nothing due right now"}
            description={
              finished
                ? `You reviewed ${done} card${done === 1 ? "" : "s"}. They will come back exactly when you are about to forget them.`
                : filter?.deck || filter?.tag
                  ? "Nothing in this group is due right now. Everything here is fresh in your memory."
                  : "Cards with a question and an answer show up here when it is time to see them again. Capture a Q & A card to get started."
            }
            action={
              <Button className="mt-2" onClick={onExit}>
                Back to cards
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  const rotation = drag / 22;
  const swipeHint = drag > 40 ? "good" : drag < -40 ? "again" : null;

  return (
    <div className="flex h-full flex-col px-4 pb-6 pt-4">
      <Header
        onExit={onExit}
        done={done}
        total={queue.length}
        onUndo={index > 0 ? () => void undoLast() : undefined}
      />

      <div className="relative flex flex-1 items-center justify-center py-4">
        {/* The next card, peeking out to show progress has depth. */}
        {queue[index + 1] && (
          <div className="absolute inset-x-4 top-8 h-[70%] scale-95 rounded-3xl border border-line bg-surface/60" />
        )}

        <button
          onClick={() => {
            haptic(10);
            setFlipped((f) => !f);
          }}
          onTouchStart={(e) => {
            startX.current = e.touches[0].clientX;
          }}
          onTouchMove={(e) => {
            if (startX.current === null) return;
            setDrag(e.touches[0].clientX - startX.current);
          }}
          onTouchEnd={() => {
            if (flipped && Math.abs(drag) > SWIPE_THRESHOLD) {
              void answer(drag > 0 ? "good" : "again");
            } else {
              setDrag(0);
            }
            startX.current = null;
          }}
          style={{
            transform: exiting
              ? `translateX(${exiting === "again" ? -420 : 420}px) rotate(${exiting === "again" ? -18 : 18}deg)`
              : `translateX(${drag}px) rotate(${rotation}deg)`,
            transition: startX.current === null ? "transform .22s cubic-bezier(.2,.9,.3,1)" : undefined,
          }}
          className={cn(
            "card-surface relative z-10 flex h-full w-full flex-col justify-center overflow-y-auto p-6 text-left",
            exiting && "opacity-0 transition-opacity duration-200",
          )}
        >
          {swipeHint && (
            <span
              className={cn(
                "absolute right-4 top-4 rounded-xl border-2 px-3 py-1 text-sm font-black uppercase",
                swipeHint === "good"
                  ? "border-good text-good"
                  : "border-danger text-danger",
              )}
            >
              {swipeHint === "good" ? "Got it" : "Again"}
            </span>
          )}

          {current.deck && (
            <span className="chip mb-3 self-start bg-raised text-muted">{current.deck}</span>
          )}

          <Markdown
            text={current.front}
            className="text-[19px] font-semibold"
            attachmentsDir={library?.attachments_dir}
          />

          {flipped ? (
            <>
              <div className="my-5 h-px bg-line" />
              <Markdown
                text={current.back || "_No answer on this card yet._"}
                attachmentsDir={library?.attachments_dir}
              />
            </>
          ) : (
            <p className="absolute inset-x-0 bottom-6 text-center text-sm text-muted">
              Tap to reveal the answer
            </p>
          )}
        </button>
      </div>

      {flipped ? (
        <div className="grid grid-cols-3 gap-2 animate-fade-in">
          <GradeButton
            grade="again"
            label="Again"
            hint={untilDue(new Date(Date.now() + 600_000).toISOString())}
            icon={<X className="h-5 w-5" />}
            onClick={() => void answer("again")}
          />
          <GradeButton
            grade="good"
            label="Good"
            hint={nextInterval(current, "good")}
            icon={<Check className="h-5 w-5" />}
            onClick={() => void answer("good")}
          />
          <GradeButton
            grade="easy"
            label="Easy"
            hint={nextInterval(current, "easy")}
            icon={<Sparkles className="h-5 w-5" />}
            onClick={() => void answer("easy")}
          />
        </div>
      ) : (
        <Button size="lg" block onClick={() => setFlipped(true)}>
          Show answer
        </Button>
      )}
    </div>
  );
}

/** Preview of the next interval, mirroring `Review::grade` in Rust. */
function nextInterval(card: Card, grade: Exclude<Grade, "again">): string {
  const { reps, interval, ease } = card.review;
  let days: number;
  if (grade === "good") {
    days = reps === 0 ? 1 : reps === 1 ? 3 : Math.max(1, interval * ease);
  } else {
    const nextEase = Math.min(3, ease + 0.15);
    days = reps === 0 ? 3 : reps === 1 ? 6 : Math.max(1, interval * nextEase * 1.3);
  }
  return untilDue(new Date(Date.now() + Math.min(365, days) * 86_400_000).toISOString());
}

function GradeButton({
  grade,
  label,
  hint,
  icon,
  onClick,
}: {
  grade: Grade;
  label: string;
  hint: string;
  icon: JSX.Element;
  onClick: () => void;
}) {
  const tone =
    grade === "again"
      ? "border-danger/40 text-danger active:bg-danger/10"
      : grade === "good"
        ? "border-good/40 text-good active:bg-good/10"
        : "border-brand/40 text-brand active:bg-brand-soft";
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-[68px] flex-col items-center justify-center gap-0.5 rounded-2xl border-2 font-bold transition active:scale-95",
        tone,
      )}
    >
      {icon}
      <span className="text-sm leading-none">{label}</span>
      <span className="text-[11px] font-medium opacity-70">{hint}</span>
    </button>
  );
}

function Header({
  onExit,
  done,
  total,
  onUndo,
}: {
  onExit: () => void;
  done: number;
  total: number;
  onUndo?: () => void;
}) {
  const progress = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <div className="flex items-center gap-3">
      <IconButton label="End session" onClick={onExit}>
        <RotateCcw className="h-5 w-5 rotate-90" />
      </IconButton>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <span className="text-sm font-bold tabular-nums text-muted">
        {done}/{total}
      </span>
      {onUndo && (
        <IconButton label="Undo last answer" onClick={onUndo}>
          <Undo2 className="h-5 w-5" />
        </IconButton>
      )}
    </div>
  );
}
