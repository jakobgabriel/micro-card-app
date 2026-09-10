/** Small, dependency-free primitives. Everything is sized for thumbs. */
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn, haptic } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "lg" | "sm";
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-lift active:bg-brand/90 disabled:bg-brand/50",
  secondary: "bg-raised text-ink border border-line active:bg-line",
  ghost: "text-ink active:bg-raised",
  soft: "bg-brand-soft text-brand active:bg-brand/20",
  danger: "bg-danger/10 text-danger active:bg-danger/20",
};

const SIZES = {
  sm: "h-9 px-3 text-sm rounded-xl",
  md: "h-12 px-4 text-[15px] rounded-2xl",
  lg: "h-14 px-6 text-base rounded-2xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, block, className, children, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold",
        "transition-[transform,background-color] duration-100 active:scale-[.97]",
        "disabled:pointer-events-none disabled:opacity-60",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      onClick={(event) => {
        haptic();
        onClick?.(event);
      }}
      disabled={loading || rest.disabled}
      {...rest}
    >
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      {children}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: "default" | "danger" | "brand";
}

export function IconButton({
  label,
  tone = "default",
  className,
  children,
  onClick,
  ...rest
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn(
        "grid h-11 w-11 shrink-0 place-items-center rounded-full transition active:scale-90",
        tone === "danger" && "text-danger active:bg-danger/10",
        tone === "brand" && "text-brand active:bg-brand-soft",
        tone === "default" && "text-muted active:bg-raised",
        className,
      )}
      onClick={(event) => {
        haptic();
        onClick?.(event);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-5 w-5 animate-spin text-muted", className)} />;
}

/** Round progress indicator used for the daily review goal. */
export function ProgressRing({
  value,
  max,
  size = 56,
  children,
}: {
  value: number;
  max: number;
  size?: number;
  children?: ReactNode;
}) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const stroke = 5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-line"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className="stroke-brand transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-sm font-bold">
        {children}
      </div>
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("no-scrollbar flex gap-1.5 overflow-x-auto", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => {
              haptic();
              onChange(option.value);
            }}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition",
              active
                ? "bg-brand text-white shadow-lift"
                : "bg-raised text-muted active:bg-line",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-8 py-14 text-center animate-fade-in">
      <div className="grid h-16 w-16 place-items-center rounded-3xl bg-brand-soft text-brand">
        {icon}
      </div>
      <h3 className="text-lg font-bold">{title}</h3>
      <p className="max-w-xs text-sm leading-relaxed text-muted">{description}</p>
      {action}
    </div>
  );
}

export function Chip({
  children,
  className,
  onClick,
  active,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={
        onClick
          ? () => {
              haptic(8);
              onClick();
            }
          : undefined
      }
      className={cn(
        "chip transition",
        active ? "bg-brand text-white" : "bg-raised text-muted",
        onClick && "active:scale-95",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
