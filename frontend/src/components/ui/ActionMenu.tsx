import { ReactNode, useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

/** Widest the menu gets in practice (labels like "Import from Qase (JSON)"). */
const MENU_WIDTH_PX = 288;

export type ActionMenuItem = { key: string; icon: ReactNode; label: ReactNode; onSelect: () => void; danger?: boolean };

/** "⋮" button opening a small action menu; closes on outside click, Esc or a pick. */
export function ActionMenu({ items, label }: { items: ActionMenuItem[]; label: string }) {
  const [open, setOpen] = useState(false);
  // Open towards the left when there is no room on the right (e.g. a "⋮" at the
  // page's right edge), so the menu never widens the page.
  const [alignRight, setAlignRight] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  function toggle() {
    if (!open && rootRef.current) {
      const { left } = rootRef.current.getBoundingClientRect();
      setAlignRight(left + MENU_WIDTH_PX > document.documentElement.clientWidth - 8);
    }
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div role="menu" className={`absolute ${alignRight ? "right-0" : "left-0"} z-30 mt-1 min-w-[12rem] rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900`}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.onSelect(); }}
              className={`flex w-full items-center gap-2 whitespace-nowrap rounded px-2.5 py-1.5 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${it.danger ? "text-red-600 dark:text-red-400" : ""}`}
            >
              <span className="shrink-0 text-slate-500">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
