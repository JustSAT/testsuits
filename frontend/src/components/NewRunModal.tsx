import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { ListChecks, X } from "lucide-react";
import { api } from "../lib/api";
import { logger } from "../lib/logger";
import { useAuth } from "../lib/auth";
import { useZodForm } from "../lib/useZodForm";
import { nonEmpty } from "../lib/schemas";
import { apiErrorMessage } from "../lib/apiError";
import { activeOf, useConfigOptions } from "../lib/configOptions";
import { Field } from "./Field";
import { Button } from "./ui/Button";
import { MultiSelect } from "./ui/MultiSelect";
import { CasePickerModal } from "./CasePickerModal";

const schema = z.object({
  name: nonEmpty("Run name"),
  milestoneId: z.string().optional(),
  environmentId: z.string().optional(),
  dueDate: z.string().optional(),
  description: z.string().optional(),
  assigneeId: z.string().optional(),
});
type Values = z.infer<typeof schema>;

/** "2026/10/26" — the date part of the default run name, as Qase names runs. */
function todayStamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

type Props = {
  /** The current project: runs are created inside it, Qase style. */
  projectId: string;
  onClose: () => void;
};

/**
 * "New test run" dialog, laid out like Qase's: project and name, description,
 * environment and milestone, assignee and due date, the run configurations
 * (platform / connectivity / locale combinations) and the test cases, picked
 * from the repository in CasePickerModal.
 */
export function NewRunModal({ projectId, onClose }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isManager = user?.role === "MANAGER" || user?.role === "ADMIN";

  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [connectivities, setConnectivities] = useState<string[]>([]);
  const [locales, setLocales] = useState<string[]>([]);
  const [casesError, setCasesError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useZodForm<Values>(schema, {
    defaultValues: {
      name: t("runs.default_name", { date: todayStamp() }),
      milestoneId: "",
      environmentId: "",
      dueDate: "",
      description: "",
      assigneeId: !isManager && user?.id ? user.id : "",
    },
  });
  // Esc closes the dialog unless the case picker on top of it is open.
  useEffect(() => {
    if (pickerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen, onClose]);

  const { data: environments = [] } = useQuery<{ id: string; title: string; slug: string }[]>({
    queryKey: ["environments", projectId],
    queryFn: async () => (await api.get("/environments", { params: { projectId } })).data,
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
  const { data: configOptions = [] } = useConfigOptions();
  const options = (kind: "PLATFORM" | "CONNECTIVITY" | "LOCALE") =>
    activeOf(configOptions, kind).map((o) => ({ value: o.code, label: o.label, searchText: o.label }));

  const create = useMutation({
    mutationFn: async (values: Values) =>
      (await api.post("/runs", {
        projectId,
        milestoneId: values.milestoneId || null,
        name: values.name,
        description: values.description || null,
        environmentId: values.environmentId || null,
        platforms: platforms.length ? platforms : undefined,
        connectivities: connectivities.length ? connectivities : undefined,
        locales: locales.length ? locales : undefined,
        dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : null,
        caseIds,
        assigneeId: values.assigneeId || null,
      }, { silent: true })).data,
    onSuccess: (run) => {
      logger.info("run created", { runId: run.id, cases: caseIds.length, platforms, connectivities, locales });
      toast.success(t("common.saved"));
      qc.invalidateQueries({ queryKey: ["runs"] });
      onClose();
    },
    onError: (e: unknown) => {
      const msg = apiErrorMessage(e, t("common.something_went_wrong"));
      setSubmitError(msg);
      logger.error("run create failed", { msg });
    },
  });

  function onValid(values: Values) {
    if (caseIds.length === 0) {
      setCasesError(t("runs.validation.case_required"));
      return;
    }
    setCasesError(null);
    setSubmitError(null);
    create.mutate(values);
  }

  const errors = form.formState.errors;
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/40 p-4 sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-run-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        noValidate
        onSubmit={form.handleSubmit(onValid)}
        className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl dark:border dark:border-slate-800 dark:bg-slate-900 space-y-4"
      >
        <header className="flex items-start justify-between gap-3">
          <h2 id="new-run-title" className="text-xl font-semibold">{t("runs.new_test_run")}</h2>
          <button type="button" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" aria-label={t("common.close")} onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <Field name="name" label={t("runs.run_name")} error={errors.name?.message}>
          <input className="input" {...form.register("name")} />
        </Field>

        <Field name="description" label={t("common.description")} error={errors.description?.message}>
          <input className="input" placeholder={t("runs.description_placeholder")} {...form.register("description")} />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field name="environmentId" label={t("runs.environment")} error={errors.environmentId?.message}>
            <select className="input" {...form.register("environmentId")}>
              <option value="">{t("runs.not_set")}</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
            {environments.length === 0 && (
              <Link to={`/projects/${projectId}/environments`} className="mt-1 inline-block text-xs text-brand-600 hover:underline dark:text-brand-300" onClick={onClose}>
                {t("environments.none_yet_link")}
              </Link>
            )}
          </Field>
          <Field name="milestoneId" label={t("runs.milestone")} error={errors.milestoneId?.message}>
            <select className="input" {...form.register("milestoneId")}>
              <option value="">{t("runs.not_set")}</option>
              {milestones.map((m: { id: string; name: string }) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          <Field name="assigneeId" label={t("runs.default_assignee")} error={errors.assigneeId?.message}>
            <select className="input" {...form.register("assigneeId")}>
              <option value="">{t("common.unassigned")}</option>
              {users.map((u: { id: string; name: string }) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </Field>
          <Field name="dueDate" label={t("runs.due_date")} error={errors.dueDate?.message}>
            <input type="date" className="input" {...form.register("dueDate")} />
          </Field>
        </div>

        <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <h3 className="font-semibold">{t("runs.configurations")}</h3>
          <p className="text-xs text-slate-500">{t("runs.configurations_hint")}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ["PLATFORM", t("platform.label"), platforms, setPlatforms],
              ["CONNECTIVITY", t("connectivity.label"), connectivities, setConnectivities],
              ["LOCALE", t("locale.label"), locales, setLocales],
            ] as const).map(([kind, label, value, setValue]) => {
              const opts = options(kind);
              return (
                <div key={kind}>
                  <label className="label" htmlFor={`run-${kind}`}>{label}</label>
                  {opts.length === 0 ? (
                    <p className="text-xs text-slate-500">{t("runs.no_options_configured")}</p>
                  ) : (
                    <MultiSelect
                      id={`run-${kind}`}
                      options={opts}
                      value={value}
                      onChange={setValue}
                      placeholder={t("runs.not_set")}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
          <h3 className="font-semibold">{t("runs.include_cases")}</h3>
          <div className="flex gap-2" role="tablist">
            <span role="tab" aria-selected="true" className="rounded bg-slate-100 px-3 py-1.5 text-sm font-medium dark:bg-slate-800">
              {t("runs.from_repository")}
            </span>
          </div>
          <div
            className={`flex items-center gap-3 rounded border p-2 ${casesError ? "border-red-400" : "border-transparent"}`}
            aria-invalid={casesError ? true : undefined}
            aria-describedby={casesError ? "run-cases-error" : undefined}
          >
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPickerOpen(true)}
            >
              <ListChecks size={16} /> {t("runs.picker.open")}
            </button>
            <span className="flex-1 text-right text-sm text-slate-600 dark:text-slate-300">
              {t("runs.picker.selected_count", { count: caseIds.length })}
            </span>
            {caseIds.length > 0 && (
              <button
                type="button"
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                aria-label={t("runs.picker.clear")}
                title={t("runs.picker.clear")}
                onClick={() => setCaseIds([])}
              >
                <X size={16} />
              </button>
            )}
          </div>
          {casesError && <p id="run-cases-error" role="alert" className="text-xs text-red-600">{casesError}</p>}
        </section>

        {submitError && <div role="alert" className="text-sm text-red-600">{submitError}</div>}
        <footer className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? t("common.please_wait") : t("runs.start_run")}
          </Button>
        </footer>
      </form>

      {pickerOpen && (
        <CasePickerModal
          projectId={projectId}
          initialSelected={caseIds}
          onCancel={() => setPickerOpen(false)}
          onDone={(ids) => {
            setCaseIds(ids);
            setPickerOpen(false);
            if (ids.length) setCasesError(null);
            logger.info("run cases picked", { projectId, count: ids.length });
          }}
        />
      )}
    </div>
  );
}
