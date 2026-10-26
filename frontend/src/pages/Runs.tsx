import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, List, LayoutGrid, Archive, RotateCcw, ListChecks, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "../lib/api";
import { runStatusColors } from "../lib/status";
import { Badge } from "../components/ui/Badge";
import { TEST_LEVELS } from "../lib/enums";
import { activeOf, makeLabelLookup, useConfigOptions } from "../lib/configOptions";
import { logger } from "../lib/logger";
import { useAuth } from "../lib/auth";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { Field } from "../components/Field";
import { useZodForm } from "../lib/useZodForm";
import { nonEmpty } from "../lib/schemas";
import { apiErrorMessage } from "../lib/apiError";
import { CasePickerModal } from "../components/CasePickerModal";

const KANBAN_COLUMNS = ["DRAFT", "IN_PROGRESS", "COMPLETED"] as const;

const schema = z.object({
  projectId: nonEmpty("Project"),
  name: nonEmpty("Run name"),
  milestoneId: z.string().optional(),
  environment: nonEmpty("Environment"),
  dueDate: z.string().optional(),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
});
type Values = z.infer<typeof schema>;

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
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedConnectivities, setSelectedConnectivities] = useState<string[]>([]);
  const [selectedLocales, setSelectedLocales] = useState<string[]>([]);
  const [testLevels, setTestLevels] = useState<string[]>([]);
  const [suiteError, setSuiteError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useZodForm<Values>(schema, {
    defaultValues: {
      projectId: projectIdFilter,
      name: "",
      milestoneId: "",
      environment: "",
      dueDate: "",
      description: "",
      assigneeId: !isManager && user?.id ? user.id : "",
    },
  });
  const projectId = form.watch("projectId");

  // Picked cases belong to one project; switching projects starts over.
  useEffect(() => {
    setSelectedCaseIds([]);
  }, [projectId]);

  const runsParams: Record<string, string> = {};
  if (projectIdFilter) runsParams.projectId = projectIdFilter;
  if (milestoneIdFilter) runsParams.milestoneId = milestoneIdFilter;
  if (tab === "archived") runsParams.archived = "true";

  const { data: runs = [] } = useQuery({
    queryKey: ["runs", runsParams],
    queryFn: async () => (await api.get("/runs", { params: runsParams })).data,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: async () => (await api.get("/projects")).data,
  });

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}`)).data,
    enabled: !!projectId,
  });

  const { data: milestones = [] } = useQuery({
    queryKey: ["milestones", projectId],
    queryFn: async () => (await api.get("/milestones", { params: { projectId } })).data,
    enabled: !!projectId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/users")).data,
  });

  // Company-scoped run parameter options. Active rows drive the checkboxes
  // below; deleted rows are kept so historical runs still render real labels.
  const { data: configOptions = [] } = useConfigOptions();
  const activePlatforms = activeOf(configOptions, "PLATFORM");
  const activeConnectivities = activeOf(configOptions, "CONNECTIVITY");
  const activeLocales = activeOf(configOptions, "LOCALE");
  const platformLabel = makeLabelLookup(configOptions, "PLATFORM");
  const connectivityLabel = makeLabelLookup(configOptions, "CONNECTIVITY");
  const localeLabel = makeLabelLookup(configOptions, "LOCALE");

  const create = useMutation({
    mutationFn: async (values: Values) =>
      (await api.post("/runs", {
        projectId: values.projectId,
        milestoneId: values.milestoneId || null,
        name: values.name,
        description: values.description || null,
        environment: values.environment,
        platforms: selectedPlatforms.length ? selectedPlatforms : undefined,
        connectivities: selectedConnectivities.length ? selectedConnectivities : undefined,
        locales: selectedLocales.length ? selectedLocales : undefined,
        testLevels: testLevels.length ? testLevels : undefined,
        dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : null,
        caseIds: selectedCaseIds,
        assigneeId: values.assigneeId || null,
      }, { silent: true })).data,
    onSuccess: (run) => {
      logger.info("run created", {
        runId: run.id,
        platforms: selectedPlatforms,
        connectivities: selectedConnectivities,
        locales: selectedLocales,
        levels: testLevels,
      });
      toast.success(t("common.saved"));
      qc.invalidateQueries({ queryKey: ["runs"] });
      setOpen(false);
      form.reset({
        projectId: projectIdFilter,
        name: "",
        milestoneId: "",
        environment: "",
        dueDate: "",
        description: "",
        assigneeId: !isManager && user?.id ? user.id : "",
      });
      setSelectedCaseIds([]);
      setSelectedPlatforms([]);
      setSelectedConnectivities([]);
      setSelectedLocales([]);
      setTestLevels([]);
      setSuiteError(null);
      setSubmitError(null);
    },
    onError: (e: unknown) => {
      const msg = apiErrorMessage(e, t("common.something_went_wrong"));
      setSubmitError(msg);
      logger.error("run create failed", { msg });
    },
  });

  function onValid(values: Values) {
    if (selectedCaseIds.length === 0) {
      setSuiteError(t("runs.validation.case_required"));
      return;
    }
    setSuiteError(null);
    setSubmitError(null);
    create.mutate(values);
  }

  function closeForm() {
    setOpen(false);
    form.reset({
      projectId: projectIdFilter,
      name: "",
      milestoneId: "",
      environment: "",
      dueDate: "",
      description: "",
      assigneeId: !isManager && user?.id ? user.id : "",
    });
    setSelectedCaseIds([]);
    setSelectedPlatforms([]);
    setSelectedConnectivities([]);
    setSelectedLocales([]);
    setTestLevels([]);
    setSuiteError(null);
    setSubmitError(null);
  }

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
        <form noValidate onSubmit={form.handleSubmit(onValid)} className="card p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field name="projectId" label={t("runs.project")} error={form.formState.errors.projectId?.message}>
              <select
                className="input"
                {...form.register("projectId", {
                  onChange: () => {
                    setSelectedCaseIds([]);
                    form.setValue("milestoneId", "");
                  },
                })}
              >
                <option value="">{t("runs.select_project")}</option>
                {projects.map((p: { id: string; name: string }) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field name="name" label={t("runs.run_name")} error={form.formState.errors.name?.message}>
              <input className="input" {...form.register("name")} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Field name="milestoneId" label={t("runs.milestone")} error={form.formState.errors.milestoneId?.message}>
              <select className="input" disabled={!projectId} {...form.register("milestoneId")}>
                <option value="">—</option>
                {milestones.map((m: { id: string; name: string }) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
            <Field name="environment" label={t("runs.environment")} error={form.formState.errors.environment?.message}>
              <input className="input" placeholder={t("runs.environment_placeholder")} {...form.register("environment")} />
            </Field>
            <Field name="dueDate" label={t("runs.due_date")} error={form.formState.errors.dueDate?.message}>
              <input type="date" className="input" {...form.register("dueDate")} />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">{t("platform.label")}</label>
              <div className="flex gap-2 flex-wrap">
                {activePlatforms.length === 0 && <span className="text-xs text-slate-500">{t("runs.no_options_configured")}</span>}
                {activePlatforms.map((p) => (
                  <label key={p.code} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedPlatforms.includes(p.code)}
                      onChange={() => setSelectedPlatforms((xs) => xs.includes(p.code) ? xs.filter((x) => x !== p.code) : [...xs, p.code])}
                    />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{t("connectivity.label")}</label>
              <div className="flex gap-2 flex-wrap">
                {activeConnectivities.length === 0 && <span className="text-xs text-slate-500">{t("runs.no_options_configured")}</span>}
                {activeConnectivities.map((c) => (
                  <label key={c.code} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedConnectivities.includes(c.code)}
                      onChange={() => setSelectedConnectivities((xs) => xs.includes(c.code) ? xs.filter((x) => x !== c.code) : [...xs, c.code])}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">{t("locale.label")}</label>
              <div className="flex gap-2 flex-wrap">
                {activeLocales.length === 0 && <span className="text-xs text-slate-500">{t("runs.no_options_configured")}</span>}
                {activeLocales.map((l) => (
                  <label key={l.code} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedLocales.includes(l.code)}
                      onChange={() => setSelectedLocales((xs) => xs.includes(l.code) ? xs.filter((x) => x !== l.code) : [...xs, l.code])}
                    />
                    {l.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="label">{t("test_level.filter_by")}</label>
            <div className="flex gap-2 flex-wrap">
              {TEST_LEVELS.map((lvl) => (
                <label key={lvl} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={testLevels.includes(lvl)}
                    onChange={() => setTestLevels((xs) => xs.includes(lvl) ? xs.filter((x) => x !== lvl) : [...xs, lvl])}
                  />
                  {t(`test_level.${lvl}`)}
                </label>
              ))}
            </div>
          </div>
          <Field name="assigneeId" label={t("runs.default_assignee")} error={form.formState.errors.assigneeId?.message}>
            <select className="input" {...form.register("assigneeId")}>
              <option value="">{t("common.unassigned")}</option>
              {users.map((u: { id: string; name: string }) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>
          <Field name="description" label={t("common.description")} error={form.formState.errors.description?.message}>
            <textarea className="input" rows={2} {...form.register("description")} />
          </Field>
          {project && (
            <div className="space-y-1">
              <label className="label">{t("runs.include_cases")}</label>
              <div
                className={`flex items-center gap-3 border rounded p-2 ${suiteError ? "border-red-400" : "border-slate-200 dark:border-slate-700"}`}
                aria-invalid={suiteError ? true : undefined}
                aria-describedby={suiteError ? "suites-error" : undefined}
              >
                <button type="button" className="btn-secondary" onClick={() => setPickerOpen(true)}>
                  <ListChecks size={16} /> {t("runs.picker.open")}
                </button>
                <span className="flex-1 text-sm text-slate-600 dark:text-slate-300">
                  {t("runs.picker.selected_count", { count: selectedCaseIds.length })}
                </span>
                {selectedCaseIds.length > 0 && (
                  <button
                    type="button"
                    className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                    aria-label={t("runs.picker.clear")}
                    title={t("runs.picker.clear")}
                    onClick={() => setSelectedCaseIds([])}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              {suiteError && <p id="suites-error" role="alert" className="text-xs text-red-600">{suiteError}</p>}
            </div>
          )}
          {pickerOpen && projectId && (
            <CasePickerModal
              projectId={projectId}
              initialSelected={selectedCaseIds}
              onCancel={() => setPickerOpen(false)}
              onDone={(ids) => {
                setSelectedCaseIds(ids);
                setPickerOpen(false);
                if (ids.length && suiteError) setSuiteError(null);
                logger.info("run cases picked", { projectId, count: ids.length });
              }}
            />
          )}
          {submitError && <div role="alert" className="text-sm text-red-600">{submitError}</div>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary" onClick={closeForm}>{t("common.cancel")}</button>
            <button type="submit" className="btn-primary" disabled={create.isPending}>
              {create.isPending ? t("common.please_wait") : t("common.create")}
            </button>
          </div>
        </form>
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
