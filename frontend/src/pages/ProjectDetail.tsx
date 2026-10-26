import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  FileDown,
  FileSpreadsheet,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import { logger } from "../lib/logger";
import { useAuth } from "../lib/auth";
import { apiErrorMessage } from "../lib/apiError";
import {
  buildCaseTree,
  caseTags,
  deletionImpact,
  filterCases,
  matchCases,
  type CaseFilterField,
  type CaseFilters,
  type CaseTree,
  type CaseTreeData,
  type PickerCase,
  type SuiteNode,
} from "../lib/caseTree";
import { PageLoader } from "../components/Spinner";
import { PriorityIcon } from "../components/PriorityIcon";
import { CaseFilterBar } from "../components/CaseFilterBar";
import { ActionMenu, type ActionMenuItem } from "../components/ui/ActionMenu";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { SuiteFormDialog } from "../components/repository/SuiteFormDialog";
import { CaseCreateDialog } from "../components/repository/CaseCreateDialog";
import { CasePanel } from "../components/case/CasePanel";
import { QaseImportDialog, downloadQaseExport } from "../components/repository/QaseImportDialog";

type Dialog =
  | { kind: "suite"; suiteId?: string; parentId?: string }
  | { kind: "case"; suiteId?: string }
  | { kind: "qase" }
  | null;

/**
 * A project's test repository, laid out like Qase's: the suite tree on the
 * left with case counts (sub-suites included), the selected suite's cases and
 * sub-suites on the right, search and filters on top, and a "⋮" menu on every
 * suite to create a case or sub-suite in it, edit, duplicate or delete it.
 */
export function ProjectDetail() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isManager = useAuth((s) => s.user?.role === "MANAGER" || s.user?.role === "ADMIN");

  const activeId = params.get("suite");
  const openCaseId = params.get("case");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [filterFields, setFilterFields] = useState<CaseFilterField[]>([]);
  const [filters, setFilters] = useState<CaseFilters>({});
  const [dialog, setDialog] = useState<Dialog>(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => (await api.get(`/projects/${id}`)).data,
    enabled: !!id,
  });
  const { data } = useQuery({
    queryKey: ["case-tree", id],
    queryFn: async () => (await api.get<CaseTreeData>(`/projects/${id}/case-tree`)).data,
    enabled: !!id,
  });

  // `full` drives counts in the header and what a delete removes; `tree` holds
  // only the cases passing the filters, like Qase's filtered repository.
  const full = useMemo(() => (data ? buildCaseTree(data) : null), [data]);
  const tree = useMemo(
    () => (data ? buildCaseTree({ suites: data.suites, cases: filterCases(data.cases, filters) }) : null),
    [data, filters],
  );
  const tags = useMemo(() => (data ? caseTags(data.cases) : []), [data]);

  if (isLoading || !full || !tree) return <PageLoader />;
  if (!project) return null;

  const active = activeId ? tree.byId.get(activeId) ?? null : null;
  const searching = query.trim().length > 0;
  const results = matchCases(tree, query);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["case-tree", id] });
    qc.invalidateQueries({ queryKey: ["project", id] });
  };
  const openSuite = (suiteId: string | null) => {
    const p = new URLSearchParams(params);
    if (suiteId) p.set("suite", suiteId);
    else p.delete("suite");
    setParams(p);
    setQuery("");
    if (suiteId) {
      const node = tree.byId.get(suiteId);
      if (node) setExpanded((prev) => new Set([...prev, ...node.path.map((s) => s.id)]));
    }
  };
  const openCase = (caseId: string | null) => {
    const p = new URLSearchParams(params);
    if (caseId) p.set("case", caseId);
    else p.delete("case");
    setParams(p);
  };
  const toggleChecked = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function deleteItems(suiteIds: string[], caseIds: string[]) {
    const impact = deletionImpact(full!, suiteIds, caseIds);
    const ok = await confirm({
      title: t("repository.delete_title"),
      body: t("repository.delete_body", { suites: impact.suites, cases: impact.cases }),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    // Cases inside a deleted suite go with it; only delete the rest one by one.
    const covered = new Set(suiteIds.flatMap((s) => full!.byId.get(s)?.allCaseIds ?? []));
    try {
      for (const s of suiteIds) await api.delete(`/suites/${s}`, { silent: true }).catch(ignoreNotFound);
      for (const c of caseIds.filter((c) => !covered.has(c))) await api.delete(`/cases/${c}`, { silent: true }).catch(ignoreNotFound);
      logger.info("repository items deleted", { projectId: id, suites: impact.suites, cases: impact.cases });
      toast.success(t("repository.deleted", { suites: impact.suites, cases: impact.cases }));
      setChecked(new Set());
      if (activeId && suiteIds.some((s) => isInside(full!, activeId, s))) openSuite(null);
    } catch (e) {
      logger.error("repository delete failed", { projectId: id, err: String(e) });
      toast.error(apiErrorMessage(e, t("common.something_went_wrong")));
    } finally {
      refresh();
    }
  }

  async function duplicate(node: SuiteNode) {
    try {
      const copy = (await api.post(`/suites/${node.id}/duplicate`, { name: t("repository.copy_name", { name: node.name }) }, { silent: true })).data;
      logger.info("suite duplicated", { suiteId: node.id, copyId: copy.id });
      toast.success(t("common.saved"));
      refresh();
      openSuite(copy.id);
    } catch (e) {
      logger.error("suite duplicate failed", { suiteId: node.id, err: String(e) });
      toast.error(apiErrorMessage(e, t("common.something_went_wrong")));
    }
  }

  const suiteMenu = (node: SuiteNode): ActionMenuItem[] => [
    { key: "case", icon: <Plus size={15} />, label: t("repository.create_case"), onSelect: () => setDialog({ kind: "case", suiteId: node.id }) },
    { key: "suite", icon: <FolderPlus size={15} />, label: t("repository.create_suite"), onSelect: () => setDialog({ kind: "suite", parentId: node.id }) },
    { key: "edit", icon: <Pencil size={15} />, label: t("common.edit"), onSelect: () => setDialog({ kind: "suite", suiteId: node.id }) },
    { key: "dup", icon: <Copy size={15} />, label: t("repository.duplicate"), onSelect: () => duplicate(node) },
    { key: "del", icon: <Trash2 size={15} />, label: t("common.delete"), danger: true, onSelect: () => deleteItems([node.id], []) },
  ];

  const projectMenu: ActionMenuItem[] = [
    ...(isManager
      ? [
          { key: "imp", icon: <FileSpreadsheet size={15} />, label: t("import.button"), onSelect: () => navigate(`/projects/${project.id}/import`) },
          { key: "qase-in", icon: <FileUp size={15} />, label: t("qase.import_title"), onSelect: () => setDialog({ kind: "qase" }) },
        ]
      : []),
    {
      key: "qase-out",
      icon: <FileDown size={15} />,
      label: t("qase.export"),
      onSelect: () => downloadQaseExport(project.id, project.key).catch((e) => {
        logger.error("qase export failed", { projectId: project.id, err: String(e) });
        toast.error(apiErrorMessage(e, t("common.something_went_wrong")));
      }),
    },
  ];

  const checkedSuites = [...checked].filter((k) => k.startsWith("s:")).map((k) => k.slice(2));
  const checkedCases = [...checked].filter((k) => k.startsWith("c:")).map((k) => k.slice(2));
  const rowSuites = active ? active.children : tree.roots;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/projects" className="mb-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            <ArrowLeft size={12} /> {t("projects.back_to_projects")}
          </Link>
          <h1 className="flex flex-wrap items-baseline gap-2 text-2xl font-bold">
            {t("repository.title", { name: project.name })}
            <span className="text-sm font-normal text-slate-500">
              {t("repository.counts", { cases: full.cases.length, suites: full.byId.size })}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {isManager && (
            <button className="btn-primary" onClick={() => setDialog({ kind: "case", suiteId: activeId ?? undefined })}>
              <Plus size={16} /> {t("repository.test_case")}
            </button>
          )}
          <ActionMenu items={projectMenu} label={t("common.actions")} />
        </div>
      </header>

      <CaseFilterBar
        query={query}
        onQuery={setQuery}
        fields={filterFields}
        onFields={setFilterFields}
        filters={filters}
        onFilters={setFilters}
        tags={tags}
      />

      <div className="flex min-h-[60vh] gap-4">
        <aside className={`${openCaseId ? "w-64" : "w-[22rem]"} shrink-0 self-start rounded-lg border border-slate-200 p-3 dark:border-slate-800`}>
          <div className="flex items-center gap-1.5 px-1 pb-2">
            <button type="button" onClick={() => openSuite(null)} className="flex flex-1 items-center gap-2 text-left text-lg font-semibold">
              <FolderOpen size={20} className="text-brand-600" /> {t("repository.suites")}
            </button>
            {isManager && (
              <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title={t("repository.create_suite")} aria-label={t("repository.create_suite")}
                onClick={() => setDialog({ kind: "suite" })}>
                <Plus size={16} />
              </button>
            )}
            <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title={t("runs.picker.expand_all")} aria-label={t("runs.picker.expand_all")}
              onClick={() => setExpanded(new Set(tree.byId.keys()))}>
              <ChevronsUpDown size={15} />
            </button>
            <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title={t("runs.picker.collapse_all")} aria-label={t("runs.picker.collapse_all")}
              onClick={() => setExpanded(new Set())}>
              <ChevronsDownUp size={15} />
            </button>
          </div>
          {tree.roots.length === 0 ? (
            <p className="px-2 py-4 text-sm text-slate-500">{t("projects.no_suites")}</p>
          ) : (
            tree.roots.map((n) => (
              <TreeRow key={n.id} node={n} depth={0} activeId={searching ? null : activeId} expanded={expanded}
                onOpen={openSuite} onToggle={(sid) => setExpanded((prev) => toggleIn(prev, sid))} />
            ))
          )}
        </aside>

        <section className="min-w-0 flex-1 space-y-3">
          {checked.size > 0 && isManager && (
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-800/40">
              <span>{t("repository.selected", { count: checked.size })}</span>
              <button type="button" className="ml-auto inline-flex items-center gap-1 text-red-600 hover:underline dark:text-red-400"
                onClick={() => deleteItems(checkedSuites, checkedCases)}>
                <Trash2 size={14} /> {t("common.delete")}
              </button>
              <button type="button" className="text-slate-500 hover:underline" onClick={() => setChecked(new Set())}>{t("runs.picker.clear")}</button>
            </div>
          )}

          {searching ? (
            <>
              <h2 className="text-lg font-semibold">{t("runs.picker.search_results", { count: results.length })}</h2>
              {results.length === 0 ? (
                <p className="text-sm text-slate-500">{t("runs.picker.no_matches")}</p>
              ) : (
                <div className="space-y-1">
                  {results.map((c) => (
                    <CaseRow key={c.id} c={c} path={tree.byId.get(c.suiteId)?.path.map((p) => p.name).join(" / ")} selected={c.id === openCaseId} onOpen={() => openCase(c.id)}
                      checked={checked.has(`c:${c.id}`)} onCheck={isManager ? () => toggleChecked(`c:${c.id}`) : undefined} />
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              {active ? (
                <div className="space-y-1">
                  <nav className="flex flex-wrap gap-1 text-xs text-slate-500">
                    <button type="button" className="hover:underline" onClick={() => openSuite(null)}>{t("repository.all_cases")}</button>
                    {active.path.map((p) => (
                      <span key={p.id} className="flex items-center gap-1">
                        <span>/</span>
                        <button type="button" className="hover:underline" onClick={() => openSuite(p.id)}>{p.name}</button>
                      </span>
                    ))}
                  </nav>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">{active.name}</h2>
                    {isManager && <ActionMenu items={suiteMenu(active)} label={t("common.actions")} />}
                  </div>
                  {active.description && <p className="whitespace-pre-line text-sm text-slate-500">{active.description}</p>}
                </div>
              ) : (
                <h2 className="text-lg font-semibold">{t("repository.all_cases")}</h2>
              )}

              <div className="space-y-1.5">
                {active?.cases.map((c) => (
                  <CaseRow key={c.id} c={c} selected={c.id === openCaseId} onOpen={() => openCase(c.id)} checked={checked.has(`c:${c.id}`)} onCheck={isManager ? () => toggleChecked(`c:${c.id}`) : undefined} />
                ))}
                {rowSuites.map((n) => (
                  <SuiteRow key={n.id} node={n} checked={checked.has(`s:${n.id}`)}
                    onCheck={isManager ? () => toggleChecked(`s:${n.id}`) : undefined}
                    onOpen={() => openSuite(n.id)} menu={isManager ? suiteMenu(n) : null} menuLabel={t("common.actions")} />
                ))}
                {active && active.cases.length === 0 && active.children.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                    {t("suites.no_cases")}
                    {isManager && (
                      <div className="mt-3">
                        <button className="btn-secondary" onClick={() => setDialog({ kind: "case", suiteId: active.id })}>
                          <Plus size={16} /> {t("repository.create_case")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {!active && tree.roots.length === 0 && (
                  <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                    {t("projects.no_suites")}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
        {openCaseId && (
          <CasePanel
            caseId={openCaseId}
            projectId={project.id}
            tree={full}
            isManager={isManager}
            onClose={() => openCase(null)}
            onChanged={refresh}
            onOpenCase={openCase}
            onDeleted={() => { openCase(null); refresh(); }}
          />
        )}
      </div>

      {dialog?.kind === "qase" && (
        <QaseImportDialog projectId={project.id} onClose={() => setDialog(null)} onImported={refresh} />
      )}
      {dialog?.kind === "suite" && (
        <SuiteFormDialog
          projectId={project.id}
          tree={full}
          suiteId={dialog.suiteId}
          defaultParentId={dialog.parentId ?? (dialog.suiteId ? undefined : activeId ?? "")}
          onClose={() => setDialog(null)}
          onSaved={(sid) => { setDialog(null); refresh(); openSuite(sid); }}
        />
      )}
      {dialog?.kind === "case" && (
        <CaseCreateDialog
          tree={full}
          defaultSuiteId={dialog.suiteId}
          onClose={() => setDialog(null)}
          onCreated={() => {
            const sid = dialog.suiteId;
            setDialog(null);
            refresh();
            if (sid) openSuite(sid);
          }}
        />
      )}
    </div>
  );
}

function ignoreNotFound(e: { response?: { status?: number } }) {
  // A suite deleted earlier in the same batch already took its sub-suites with it.
  if (e?.response?.status !== 404) throw e;
}

function toggleIn(set: Set<string>, id: string) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Whether `suiteId` is `ancestorId` or lies under it. */
function isInside(tree: CaseTree, suiteId: string, ancestorId: string) {
  return tree.byId.get(suiteId)?.path.some((p) => p.id === ancestorId) ?? false;
}

function TreeRow({ node, depth, activeId, expanded, onOpen, onToggle }: {
  node: SuiteNode;
  depth: number;
  activeId: string | null;
  expanded: Set<string>;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const isOpen = expanded.has(node.id);
  return (
    <>
      <div
        className={`flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-sm ${node.id === activeId ? "bg-brand-50 dark:bg-brand-500/15" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
        style={{ paddingLeft: 4 + depth * 18 }}
        onClick={() => onOpen(node.id)}
      >
        {node.children.length > 0 ? (
          <button type="button" className="text-slate-500" onClick={(e) => { e.stopPropagation(); onToggle(node.id); }} aria-expanded={isOpen}>
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <Folder size={17} className="shrink-0 text-slate-400" />
        <span className="flex-1 truncate" title={node.name}>{node.name}</span>
        <span className="text-xs tabular-nums text-slate-500">{node.allCaseIds.length}</span>
      </div>
      {isOpen && node.children.map((c) => (
        <TreeRow key={c.id} node={c} depth={depth + 1} activeId={activeId} expanded={expanded} onOpen={onOpen} onToggle={onToggle} />
      ))}
    </>
  );
}

function SuiteRow({ node, checked, onCheck, onOpen, menu, menuLabel }: {
  node: SuiteNode;
  checked: boolean;
  onCheck?: () => void;
  onOpen: () => void;
  menu: ActionMenuItem[] | null;
  menuLabel: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900">
      {menu ? <ActionMenu items={menu} label={menuLabel} /> : <span className="w-6" />}
      {onCheck && <input type="checkbox" checked={checked} onChange={onCheck} aria-label={node.name} />}
      <button type="button" onClick={onOpen} className="flex flex-1 items-center gap-2.5 text-left text-sm font-medium hover:underline">
        <Folder size={20} className="shrink-0 text-slate-400" />
        <span className="truncate">{node.name}</span>
      </button>
      <span className="text-xs tabular-nums text-slate-500">{node.allCaseIds.length}</span>
    </div>
  );
}

function CaseRow({ c, path, checked, onCheck, selected, onOpen }: {
  c: PickerCase;
  path?: string;
  checked: boolean;
  onCheck?: () => void;
  selected: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-3 py-2 ${selected ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-800 dark:hover:bg-slate-800/60"}`}>
      {onCheck && <input type="checkbox" className="mt-1" checked={checked} onChange={onCheck} aria-label={c.title} />}
      <span className="mt-0.5"><PriorityIcon priority={c.priority} size={17} /></span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left text-sm hover:underline">
        {c.title}
        {path && <span className="block truncate text-xs text-slate-500">{path}</span>}
      </button>
      <span className="shrink-0 text-xs text-slate-500">{t(`test_level.${c.testLevel}`)}</span>
    </div>
  );
}
