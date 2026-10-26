import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { logger } from "../lib/logger";
import { priorityTone } from "../lib/status";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { PageLoader } from "./Spinner";
import {
  buildCaseTree,
  matchCases,
  suiteState,
  toggleCases,
  type CaseTreeData,
  type PickerCase,
  type SelectionState,
  type SuiteNode,
} from "../lib/caseTree";

type Props = {
  projectId: string;
  initialSelected: string[];
  onCancel: () => void;
  onDone: (caseIds: string[]) => void;
};

/** A checkbox that also shows the "some selected" state. */
function TriCheckbox({ state, onChange, label }: { state: SelectionState["state"]; onChange: () => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === "all"}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="shrink-0"
    />
  );
}

/**
 * Picks the cases of a new run, Qase style: a suite tree on the left with
 * per-suite "selected / total" counts, the active suite's cases and sub-suites
 * on the right, and a search across every case title.
 */
export function CasePickerModal({ projectId, initialSelected, onCancel, onDone }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialSelected));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["case-tree", projectId],
    queryFn: async () => (await api.get<CaseTreeData>(`/projects/${projectId}/case-tree`)).data,
  });
  const tree = useMemo(() => (data ? buildCaseTree(data) : null), [data]);

  useEffect(() => {
    if (isError) logger.error("case tree load failed", { projectId });
  }, [isError, projectId]);

  useEffect(() => {
    if (tree && !activeId && tree.roots.length) setActiveId(tree.roots[0].id);
  }, [tree, activeId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const allIds = useMemo(() => tree?.cases.map((c) => c.id) ?? [], [tree]);
  const allState: SelectionState["state"] =
    selected.size === 0 ? "none" : selected.size === allIds.length ? "all" : "some";
  const active = activeId && tree ? tree.byId.get(activeId) ?? null : null;
  const results = tree ? matchCases(tree, query) : [];
  const searching = query.trim().length > 0;

  const toggle = (ids: string[]) => setSelected((prev) => toggleCases(prev, ids));
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const openSuite = (node: SuiteNode) => {
    setActiveId(node.id);
    setQuery("");
    // Reveal the suite in the tree.
    setExpanded((prev) => new Set([...prev, ...node.path.slice(0, -1).map((p) => p.id)]));
  };

  function CaseRow({ c, showPath }: { c: PickerCase; showPath?: boolean }) {
    const path = showPath && tree ? tree.byId.get(c.suiteId)?.path.map((p) => p.name).join(" / ") : null;
    return (
      <label className="flex items-start gap-3 px-3 py-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer">
        <input type="checkbox" className="mt-1 shrink-0" checked={selected.has(c.id)} onChange={() => toggle([c.id])} />
        <Badge tone={priorityTone(c.priority)} size="xs" className="mt-0.5 shrink-0">{t(`priority.${c.priority}`)}</Badge>
        <span className="flex-1 min-w-0">
          <span className="text-sm">{c.title}</span>
          {path && <span className="block text-xs text-slate-500 truncate">{path}</span>}
        </span>
        <span className="text-xs text-slate-500 shrink-0">{t(`test_level.${c.testLevel}`)}</span>
      </label>
    );
  }

  function TreeRow({ node, depth }: { node: SuiteNode; depth: number }) {
    const st = suiteState(node, selected);
    const isOpen = expanded.has(node.id);
    const isActive = !searching && node.id === activeId;
    return (
      <>
        <div
          className={`flex items-center gap-1.5 pr-2 py-1 rounded cursor-pointer text-sm ${isActive ? "bg-brand-50 dark:bg-brand-500/15" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => openSuite(node)}
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              className="text-slate-500"
              aria-label={isOpen ? t("runs.picker.collapse") : t("runs.picker.expand")}
              onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id); }}
            >
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-[14px]" />
          )}
          <TriCheckbox state={st.state} label={node.name} onChange={() => toggle(node.allCaseIds)} />
          <span className="flex-1 truncate" title={node.name}>{node.name}</span>
          <span className="text-xs text-slate-500 tabular-nums">{st.selected}/{st.total}</span>
        </div>
        {isOpen && node.children.map((child) => <TreeRow key={child.id} node={child} depth={depth + 1} />)}
      </>
    );
  }

  const activeState = active ? suiteState(active, selected) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="case-picker-title"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-slate-900 dark:border dark:border-slate-800 rounded-lg shadow-xl w-full max-w-6xl h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex-1">
            <h2 id="case-picker-title" className="font-semibold text-lg">{t("runs.picker.title")}</h2>
            <p className="text-xs text-slate-500">
              {t("runs.picker.selected_of", { selected: selected.size, total: allIds.length })}
            </p>
          </div>
          <button type="button" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" aria-label={t("common.close")} onClick={onCancel}>
            <X size={18} />
          </button>
        </header>

        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <div className="relative max-w-md">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-8"
              placeholder={t("runs.picker.search_placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {isLoading || !tree ? (
          <div className="flex-1 flex items-center justify-center">
            {isError ? <p role="alert" className="text-sm text-red-600">{t("common.something_went_wrong")}</p> : <PageLoader />}
          </div>
        ) : tree.cases.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-500">{t("runs.picker.no_cases")}</div>
        ) : (
          <div className="flex-1 flex min-h-0">
            <aside className="w-80 shrink-0 border-r border-slate-200 dark:border-slate-800 overflow-auto p-2">
              <div className="flex items-center gap-1.5 px-1 py-1 text-sm font-medium">
                <span className="w-[14px]" />
                <TriCheckbox state={allState} label={t("runs.picker.select_all")} onChange={() => toggle(allIds)} />
                <span className="flex-1">{t("runs.picker.select_all")}</span>
                <button type="button" className="text-slate-500" title={t("runs.picker.expand_all")} aria-label={t("runs.picker.expand_all")}
                  onClick={() => setExpanded(new Set(tree.byId.keys()))}>
                  <ChevronsUpDown size={14} />
                </button>
                <button type="button" className="text-slate-500" title={t("runs.picker.collapse_all")} aria-label={t("runs.picker.collapse_all")}
                  onClick={() => setExpanded(new Set())}>
                  <ChevronsDownUp size={14} />
                </button>
              </div>
              {tree.roots.map((root) => <TreeRow key={root.id} node={root} depth={0} />)}
            </aside>

            <section className="flex-1 overflow-auto p-4">
              {searching ? (
                <>
                  <h3 className="font-semibold mb-2">{t("runs.picker.search_results", { count: results.length })}</h3>
                  {results.length === 0 ? (
                    <p className="text-sm text-slate-500">{t("runs.picker.no_matches")}</p>
                  ) : (
                    <>
                      <label className="flex items-center gap-2 px-3 py-1 text-sm">
                        <TriCheckbox
                          state={suiteStateOf(results, selected)}
                          label={t("runs.picker.select_all")}
                          onChange={() => toggle(results.map((c) => c.id))}
                        />
                        {t("runs.picker.select_all")}
                      </label>
                      {results.map((c) => <CaseRow key={c.id} c={c} showPath />)}
                    </>
                  )}
                </>
              ) : active && activeState ? (
                <>
                  <nav className="text-xs text-slate-500 mb-1 flex flex-wrap gap-1">
                    {active.path.map((p, i) => (
                      <span key={p.id} className="flex items-center gap-1">
                        {i > 0 && <span>/</span>}
                        <button type="button" className="hover:underline" onClick={() => openSuite(p)}>{p.name}</button>
                      </span>
                    ))}
                  </nav>
                  <h3 className="font-semibold text-lg mb-2">{active.name}</h3>
                  <label className="flex items-center gap-2 px-3 py-1 text-sm">
                    <TriCheckbox state={activeState.state} label={t("runs.picker.select_all")} onChange={() => toggle(active.allCaseIds)} />
                    {t("runs.picker.select_all")}
                    <span className="text-slate-500 tabular-nums">{activeState.selected}/{activeState.total}</span>
                  </label>
                  {active.cases.length === 0 && active.children.length === 0 && (
                    <p className="text-sm text-slate-500 px-3 py-2">{t("runs.picker.empty_suite")}</p>
                  )}
                  {active.cases.map((c) => <CaseRow key={c.id} c={c} />)}
                  {active.children.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {active.children.map((child) => {
                        const st = suiteState(child, selected);
                        return (
                          <div key={child.id} className="flex items-center gap-3 px-3 py-2 rounded border border-slate-200 dark:border-slate-800">
                            <TriCheckbox state={st.state} label={child.name} onChange={() => toggle(child.allCaseIds)} />
                            <button type="button" className="flex-1 text-left text-sm font-medium hover:underline" onClick={() => openSuite(child)}>
                              {child.name}
                            </button>
                            <span className="text-xs text-slate-500 tabular-nums">{st.selected}/{st.total}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : null}
            </section>
          </div>
        )}

        <footer className="flex items-center gap-2 justify-end px-5 py-3 border-t border-slate-200 dark:border-slate-800">
          <Button variant="secondary" onClick={onCancel}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => onDone(Array.from(selected))}>{t("runs.picker.done")}</Button>
        </footer>
      </div>
    </div>
  );
}

function suiteStateOf(cases: PickerCase[], selected: Set<string>): SelectionState["state"] {
  const n = cases.filter((c) => selected.has(c.id)).length;
  return n === 0 ? "none" : n === cases.length ? "all" : "some";
}
