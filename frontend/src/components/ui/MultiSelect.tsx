import { ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

export type MultiSelectOption = { value: string; label: ReactNode; searchText?: string };

type Props = {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Shown on the trigger when nothing is selected. */
  placeholder: ReactNode;
  /** Prefix on the trigger, e.g. "Priority" → "Priority: High, Low". */
  prefix?: ReactNode;
  /** Show a search box in the menu (defaults to on above 8 options). */
  searchable?: boolean;
  /** Trigger look: full-width input (default), small chip, or a text link. */
  variant?: "input" | "chip" | "link";
  /** For the link variant: the link text, shown whatever is selected. */
  triggerLabel?: ReactNode;
  id?: string;
  "aria-label"?: string;
};

/** Dropdown with checkboxes, closing on outside click or Esc. */
export function MultiSelect({ options, value, onChange, placeholder, prefix, searchable, variant = "input", triggerLabel, id, ...aria }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const showSearch = searchable ?? options.length > 8;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter((o) => (o.searchText ?? String(o.label)).toLowerCase().includes(q))
    : options;
  const chosen = options.filter((o) => value.includes(o.value));

  return (
    <div ref={rootRef} className={`relative ${variant === "input" ? "block" : "inline-block"}`}>
      <button
        type="button"
        id={id}
        aria-label={aria["aria-label"]}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={
          variant === "link"
            ? "text-sm font-medium text-brand-600 hover:underline dark:text-brand-300"
            : variant === "chip"
              ? `inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${chosen.length ? "border-brand-500 text-brand-700 dark:text-brand-300" : "border-slate-300 dark:border-slate-700"}`
              : "input flex items-center justify-between gap-2 text-left"
        }
      >
        {variant === "link" ? (
          triggerLabel
        ) : (
          <>
            <span className={`truncate inline-flex items-center gap-1 ${chosen.length || prefix ? "" : "text-slate-400"}`}>
              {prefix && <>{prefix}{chosen.length ? ":" : ""}</>}
              {chosen.length
                ? chosen.map((o, i) => <span key={o.value} className="inline-flex items-center gap-1">{i > 0 && ", "}{o.label}</span>)
                : !prefix && placeholder}
            </span>
            <ChevronDown size={variant === "chip" ? 12 : 16} className="shrink-0 text-slate-400" />
          </>
        )}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 min-w-[14rem] w-full max-h-72 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" role="listbox" aria-multiselectable>
          {showSearch && (
            <input
              className="input mb-1 text-sm"
              placeholder={t("common.search")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          )}
          {visible.length === 0 && <div className="px-2 py-1.5 text-xs text-slate-500">{t("common.no_results")}</div>}
          {visible.map((o) => (
            <label key={o.value} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="flex items-center gap-1.5">{o.label}</span>
            </label>
          ))}
          {value.length > 0 && (
            <button type="button" className="mt-1 w-full rounded px-2 py-1.5 text-center text-xs text-brand-600 hover:bg-slate-50 dark:text-brand-300 dark:hover:bg-slate-800" onClick={() => onChange([])}>
              {t("common.clear_selection")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
