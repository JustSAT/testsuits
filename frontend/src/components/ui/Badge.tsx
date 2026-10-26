import { HTMLAttributes } from "react";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "violet"
  | "rose";

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  size?: "xs" | "sm";
  /** Use a dot prefix instead of fully tinted background — quieter alternative. */
  dot?: boolean;
};

/**
 * Public tone → className map. Exported so non-Badge controls that still need
 * badge styling (e.g. a `<select>` styled as a status chip) can reuse the
 * same dark/light pairs instead of hand-rolling them.
 */
export const badgeToneClasses: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200",
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  success: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  rose: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
};

const dots: Record<BadgeTone, string> = {
  neutral: "bg-slate-400",
  brand: "bg-brand-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-sky-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
};

const sizes = {
  xs: "px-1.5 py-0 text-[0.625rem]",
  sm: "px-2 py-0.5 text-xs",
} as const;

export function Badge({ tone = "neutral", size = "sm", dot, className, children, ...rest }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-medium ${sizes[size]} ${badgeToneClasses[tone]} ${className ?? ""}`.trim()}
      {...rest}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dots[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}
