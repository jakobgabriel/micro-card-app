/**
 * Progress, in the two forms that actually motivate: what you have done, and
 * what is coming. Deliberately small — three charts, no dashboard.
 */
import { useMemo } from "react";
import { ArrowLeft, Brain, CalendarDays, Flame, Layers, TrendingUp } from "lucide-react";

import { IconButton } from "@/components/ui";
import { useStore } from "@/lib/store";
import { KIND_STYLE, cn, isToday, shortDate } from "@/lib/utils";
import type { CardKind } from "@/lib/types";

export function Stats({ onBack }: { onBack: () => void }) {
  const { library } = useStore();
  const stats = library?.stats;

  const weeks = useMemo(() => {
    const activity = stats?.activity ?? [];
    // Twelve columns of seven days, oldest first, the way a contribution
    // graph reads.
    const out: (typeof activity)[] = [];
    for (let i = 0; i < activity.length; i += 7) out.push(activity.slice(i, i + 7));
    return out;
  }, [stats?.activity]);

  const peakActivity = Math.max(1, ...(stats?.activity ?? []).map((d) => d.count));
  const peakForecast = Math.max(1, ...(stats?.forecast ?? []).map((d) => d.count));

  if (!stats) return null;

  return (
    <div className="px-4 pb-28 pt-4">
      <header className="flex items-center gap-2">
        <IconButton label="Back" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </IconButton>
        <h1 className="text-2xl font-black">Progress</h1>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Metric
          icon={<Flame className="h-4 w-4" />}
          value={stats.streak_days}
          label={stats.streak_days === 1 ? "day in a row" : "days in a row"}
          hint={stats.best_streak > 0 ? `Best: ${stats.best_streak}` : undefined}
          highlight
        />
        <Metric
          icon={<Layers className="h-4 w-4" />}
          value={stats.total}
          label="cards kept"
          hint={stats.captured_today > 0 ? `+${stats.captured_today} today` : undefined}
        />
      </div>

      {stats.retention !== null && (
        <Section title="How well it is sticking" icon={<Brain className="h-4 w-4" />}>
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0">
              <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  strokeWidth="4"
                  className="stroke-line"
                />
                <circle
                  cx="18"
                  cy="18"
                  r="15.5"
                  fill="none"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={97.4}
                  strokeDashoffset={97.4 * (1 - stats.retention)}
                  className={cn(
                    "transition-[stroke-dashoffset] duration-700",
                    stats.retention >= 0.8 ? "stroke-brand" : "stroke-warn",
                  )}
                />
              </svg>
              <span className="absolute inset-0 grid place-items-center text-sm font-black tabular-nums">
                {Math.round(stats.retention * 100)}%
              </span>
            </div>
            <p className="text-sm leading-relaxed text-muted">
              {stats.retention >= 0.8
                ? "You recall most cards when they come back — the intervals are about right."
                : "A lot of cards are slipping. Shorter cards, or more sessions, usually fixes it."}{" "}
              <span className="block pt-1 text-xs">
                Share of the last month's reviews you got right.
              </span>
            </p>
          </div>
        </Section>
      )}

      <Section title="Last twelve weeks" icon={<CalendarDays className="h-4 w-4" />}>
        <div className="flex gap-1">
          {weeks.map((week, index) => (
            <div key={index} className="flex flex-1 flex-col gap-1">
              {week.map((day) => (
                <div
                  key={day.date}
                  title={`${shortDate(day.date)}: ${day.count}`}
                  className={cn(
                    "aspect-square w-full rounded-[3px]",
                    day.count === 0 && "bg-raised",
                    day.count > 0 && day.count <= peakActivity * 0.33 && "bg-brand/30",
                    day.count > peakActivity * 0.33 &&
                      day.count <= peakActivity * 0.66 &&
                      "bg-brand/60",
                    day.count > peakActivity * 0.66 && "bg-brand",
                    isToday(day.date) && "ring-2 ring-accent ring-offset-1 ring-offset-surface",
                  )}
                />
              ))}
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-xs text-muted">
          Each square is a day you captured or reviewed something.
        </p>
      </Section>

      <Section title="Coming up" icon={<TrendingUp className="h-4 w-4" />}>
        <div className="flex h-28 items-end gap-1">
          {stats.forecast.map((day, index) => (
            <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-bold tabular-nums text-muted">
                {day.count > 0 ? day.count : ""}
              </span>
              <div
                title={`${shortDate(day.date)}: ${day.count} due`}
                style={{ height: `${Math.max(4, (day.count / peakForecast) * 72)}px` }}
                className={cn(
                  "w-full rounded-t-md",
                  index === 0 ? "bg-accent" : "bg-brand/70",
                  day.count === 0 && "bg-line",
                )}
              />
              {index % 3 === 0 && (
                <span className="text-[9px] text-muted">{dayOfMonth(day.date)}</span>
              )}
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          Cards falling due over the next two weeks. Today is highlighted.
        </p>
      </Section>

      {stats.kinds.length > 0 && (
        <Section title="What you capture">
          <div className="space-y-2">
            {stats.kinds.map((kind) => {
              const style = KIND_STYLE[kind.kind as CardKind];
              const share = (kind.count / Math.max(1, stats.total)) * 100;
              return (
                <div key={kind.kind} className="flex items-center gap-3">
                  <span className="w-16 text-sm font-medium">{style?.label ?? kind.kind}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-raised">
                    <div
                      className={cn("h-full rounded-full", style?.dot ?? "bg-brand")}
                      style={{ width: `${Math.max(3, share)}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm tabular-nums text-muted">
                    {kind.count}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

/** Just the day number, for the dense forecast axis. */
function dayOfMonth(iso: string): string {
  return String(Number(iso.slice(8, 10)));
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-bold uppercase tracking-wide text-muted">
        {icon}
        {title}
      </h2>
      <div className="card-surface p-4">{children}</div>
    </section>
  );
}

function Metric({
  icon,
  value,
  label,
  hint,
  highlight,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div className="card-surface p-4">
      <div className={cn("flex items-center gap-1.5", highlight ? "text-accent" : "text-muted")}>
        {icon}
        <span className="text-xs font-bold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1 text-3xl font-black tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
