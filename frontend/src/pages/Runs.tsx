import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, List, LayoutGrid, Archive, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../lib/api";
import { runStatusColors } from "../lib/status";
import { Badge } from "../components/ui/Badge";
import { makeLabelLookup, useConfigOptions } from "../lib/configOptions";
import { logger } from "../lib/logger";
import { useAuth } from "../lib/auth";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { NewRunModal } from "../components/NewRunModal";

const KANBAN_COLUMNS = ["DRAFT", "IN_PROGRESS", "COMPLETED"] as const;

export function Runs() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const user = useAuth((s) => s.user);
  const isManager = user?.role === "MANAGER" || user?.role === "ADMIN";
  const view = params.get("view") === "kanban" ? "kanban" : "list";
  const tab = params.get("tab") === "archived" ? "archived" : "active";
  const projectIdFilter = params.get("projectId") ?? "";
  const milestoneIdFilter = params.get("milestoneId") ?? "";
  const qc = useQueryClient();
  const confirmDialog = useConfirm();

  const [open, setOpen] = useState(false);

  const runsParams: Record<string, string> = {};
  if (projectIdFilter) runsParams.projectId = projectIdFilter;
  if (milestoneIdFilter) runsParams.milestoneId = milestoneIdFilter;
  if (tab === "archived") runsParams.archived = "true";

  const { data: runs = [] } = useQuery({
    queryKey: ["runs", runsParams],
    queryFn: async () => (await api.get("/runs", { params: runsParams })).data,
  });

  // Company-scoped run parameter options; deleted rows are kept so historical
  // runs still render real labels.
  const { data: configOptions = [] } = useConfigOptions();
  const platformLabel = makeLabelLookup(configOptions, "PLATFORM");
  const connectivityLabel = makeLabelLookup(configOptions, "CONNECTIVITY");
  const localeLabel = makeLabelLookup(configOptions, "LOCALE");

  const setView = (next: "list" | "kanban") => {
    const p = new URLSearchParams(params);
    if (next === "list") p.delete("view");
    else p.set("view", next);
    setParams(p, { replace: true });
  };

  const setTab = (next: "active" | "archived") => {
    const p = new URLSearchParams(params);
    if (next === "active") { p.delete("tab"); p.delete("view"); }
    else { p.set("tab", next); p.delete("view"); }
    setParams(p, { replace: true });
  };

  const archiveRun = useMutation({
    mutationFn: async ({ runId, archive }: { runId: string; archive: boolean }) =>
      (await api.patch(`/runs/${runId}`, { status: archive ? "ARCHIVED" : "COMPLETED" })).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      const msg = vars.archive ? t("runs.archived_toast") : t("runs.unarchived_toast");
      toast.success(msg);
      logger.info(vars.archive ? "run archived" : "run unarchived", { runId: vars.runId });
    },
  });

  async function onArchive(e: React.MouseEvent, runId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (await confirmDialog({ title: t("runs.archive_confirm"), tone: "warning" })) {
      archiveRun.mutate({ runId, archive: true });
    }
  }

  function onUnarchive(e: React.MouseEvent, runId: string) {
    e.preventDefault();
    e.stopPropagation();
    archiveRun.mutate({ runId, archive: false });
  }

  const updateStatus = useMutation({
    mutationFn: async ({ runId, status }: { runId: string; status: string }) =>
      (await api.patch(`/runs/${runId}`, { status })).data,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["runs"] });
      logger.info("run status changed via kanban", { runId: vars.runId, status: vars.status });
    },
  });

  function onDragStart(e: React.DragEvent<HTMLAnchorElement>, runId: string) {
    e.dataTransfer.setData("text/run-id", runId);
    e.dataTransfer.effectAllowed = "move";
  }
  function onColumnDrop(e: React.DragEvent<HTMLDivElement>, status: string) {
    e.preventDefault();
    const runId = e.dataTransfer.getData("text/run-id");
    if (!runId) return;
    const run = runs.find((r: { id: string; status: string }) => r.id === runId);
    if (run && run.status !== status) updateStatus.mutate({ runId, status });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("runs.title")}</h1>
          <p className="text-sm text-slate-500">{t("runs.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" role="tablist" aria-label={t("runs.tab_active")}>
            <button
              type="button"
              className={`px-2.5 py-1.5 text-xs inline-flex items-center gap-1 ${tab === "active" ? "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
              onClick={() => setTab("active")}
              aria-pressed={tab === "active"}
            >
              {t("runs.tab_active")}
            </button>
            <button
              type="button"
              className={`px-2.5 py-1.5 text-xs inline-flex items-center gap-1 ${tab === "archived" ? "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
              onClick={() => setTab("archived")}
              aria-pressed={tab === "archived"}
            >
              <Archive size={14} /> {t("runs.tab_archived")}
            </button>
          </div>
          {tab === "active" && (
            <>
              <div className="inline-flex rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900" role="tablist" aria-label={t("runs.view_toggle")}>
                <button
                  type="button"
                  className={`px-2.5 py-1.5 text-xs inline-flex items-center gap-1 ${view === "list" ? "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
                  onClick={() => setView("list")}
                  aria-pressed={view === "list"}
                >
                  <List size={14} /> {t("runs.view_list")}
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1.5 text-xs inline-flex items-center gap-1 ${view === "kanban" ? "bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`}
                  onClick={() => setView("kanban")}
                  aria-pressed={view === "kanban"}
                >
                  <LayoutGrid size={14} /> {t("runs.view_kanban")}
                </button>
              </div>
              <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> {t("runs.new_run")}</button>
            </>
          )}
        </div>
      </header>

      {open && tab === "active" && (
        <NewRunModal defaultProjectId={projectIdFilter} onClose={() => setOpen(false)} />
      )}

      {runs.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">{tab === "archived" ? t("runs.empty_archived") : t("runs.empty")}</div>
      ) : tab === "archived" ? (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {runs.map((r: {
            id: string; name: string; project: { name: string }; milestone?: { name: string };
            platforms?: string[]; connectivities?: string[]; locales?: string[]; locale?: string; environment?: string;
            _count: { executions: number }; createdBy: { name: string }; dueDate?: string; status: string;
          }) => (
            <div key={r.id} className="flex items-center justify-between px-5 py-3">
              <Link to={`/runs/${r.id}`} className="flex-1 min-w-0 hover:underline">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                  <span>{r.project.name}</span>
                  {r.milestone && <Badge tone="violet">{r.milestone.name}</Badge>}
                  {r.environment && <Badge tone="neutral">{r.environment}</Badge>}
                  <span>{t("runs.cases_count", { count: r._count.executions })}</span>
                  <span>{t("runs.by_user", { name: r.createdBy.name })}</span>
                </div>
              </Link>
              {isManager && (
                <button
                  className="btn-secondary text-xs ml-3"
                  onClick={(e) => onUnarchive(e, r.id)}
                  disabled={archiveRun.isPending}
                >
                  <RotateCcw size={14} /> {t("runs.unarchive")}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : view === "list" ? (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {runs.map((r: {
            id: string; name: string; project: { name: string }; milestone?: { name: string };
            platforms?: string[]; connectivities?: string[]; locales?: string[]; locale?: string; environment?: string;
            _count: { executions: number }; createdBy: { name: string }; dueDate?: string; status: string;
          }) => (
            <div key={r.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
              <Link to={`/runs/${r.id}`} className="flex-1 min-w-0">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                  <span>{r.project.name}</span>
                  {r.milestone && <Badge tone="violet">{r.milestone.name}</Badge>}
                  {r.platforms?.map((p) => <Badge key={p} tone="info">{platformLabel(p)}</Badge>)}
                  {r.connectivities?.map((c) => <Badge key={c} tone="success">{connectivityLabel(c)}</Badge>)}
                  {(r.locales?.length
                    ? r.locales
                    : r.locale ? r.locale.split(",").map((l) => l.trim()).filter(Boolean) : []
                  ).map((l) => <Badge key={l} tone="rose">{localeLabel(l)}</Badge>)}
                  {r.environment && <Badge tone="neutral">{r.environment}</Badge>}
                  <span>{t("runs.cases_count", { count: r._count.executions })}</span>
                  <span>{t("runs.by_user", { name: r.createdBy.name })}</span>
                  {r.dueDate && <span>{t("runs.due_on", { date: new Date(r.dueDate).toLocaleDateString() })}</span>}
                </div>
              </Link>
              <div className="flex items-center gap-2 ml-3">
                <span className={`badge ${runStatusColors[r.status]}`}>{r.status.replace("_", " ")}</span>
                {isManager && (
                  <button
                    className="btn-secondary text-xs"
                    title={t("runs.archive")}
                    onClick={(e) => onArchive(e, r.id)}
                    disabled={archiveRun.isPending}
                  >
                    <Archive size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {isManager && (
            <p className="text-xs text-slate-500 mb-2">{t("runs.kanban_hint")}</p>
          )}
          <div className="flex md:grid md:grid-cols-3 gap-3 overflow-x-auto md:overflow-visible -mx-4 sm:-mx-0 px-4 sm:px-0 snap-x snap-mandatory md:snap-none [&>*]:min-w-[85vw] sm:[&>*]:min-w-[300px] md:[&>*]:min-w-0 [&>*]:snap-center md:[&>*]:snap-align-none">
            {KANBAN_COLUMNS.map((status) => {
              const items = runs.filter((r: { status: string }) => r.status === status);
              return (
                <div
                  key={status}
                  className="bg-slate-50 dark:bg-slate-900/60 rounded-md border border-slate-200 dark:border-slate-800 p-2 min-h-[120px]"
                  onDragOver={(e) => { if (isManager) e.preventDefault(); }}
                  onDrop={(e) => { if (isManager) onColumnDrop(e, status); }}
                >
                  <div className="flex items-center justify-between px-1 mb-2">
                    <span className={`badge ${runStatusColors[status]}`}>{status.replace("_", " ")}</span>
                    <span className="text-xs text-slate-500">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((r: {
                      id: string; name: string; project: { name: string }; milestone?: { name: string };
                      _count: { executions: number };
                    }) => (
                      <Link
                        key={r.id}
                        to={`/runs/${r.id}`}
                        draggable={isManager}
                        onDragStart={(e) => onDragStart(e, r.id)}
                        className="block bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 p-2 hover:border-brand-400 text-sm"
                      >
                        <div className="font-medium truncate">{r.name}</div>
                        <div className="text-xs text-slate-500 mt-1 flex items-center gap-1 flex-wrap">
                          <span>{r.project.name}</span>
                          {r.milestone && <Badge tone="violet" size="xs">{r.milestone.name}</Badge>}
                          <span>· {t("runs.cases_count", { count: r._count.executions })}</span>
                        </div>
                      </Link>
                    ))}
                    {items.length === 0 && (
                      <div className="text-xs text-slate-400 italic px-1 py-2">{t("runs.kanban_empty_col")}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
