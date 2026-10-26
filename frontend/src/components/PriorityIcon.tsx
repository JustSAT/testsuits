import { ArrowDown, ArrowUp, ChevronsUp, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";

const ICONS = {
  CRITICAL: { Icon: ChevronsUp, className: "text-red-600 dark:text-red-400" },
  HIGH: { Icon: ArrowUp, className: "text-red-500 dark:text-red-400" },
  MEDIUM: { Icon: Circle, className: "text-slate-400" },
  LOW: { Icon: ArrowDown, className: "text-emerald-600 dark:text-emerald-400" },
} as const;

/** Compact priority marker (Qase style); the label is in the tooltip and for screen readers. */
export function PriorityIcon({ priority, size = 14 }: { priority: string; size?: number }) {
  const { t } = useTranslation();
  const { Icon, className } = ICONS[priority as keyof typeof ICONS] ?? ICONS.MEDIUM;
  const label = t(`priority.${priority}`);
  return (
    <span title={label} aria-label={label} role="img" className={`inline-flex shrink-0 ${className}`}>
      <Icon size={size} strokeWidth={priority === "MEDIUM" ? 2.5 : 2.25} aria-hidden />
    </span>
  );
}
