import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileSpreadsheet, FolderTree, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "../lib/api";
import { logger } from "../lib/logger";
import { PageLoader } from "../components/Spinner";
import { Field } from "../components/Field";
import { useZodForm } from "../lib/useZodForm";
import { nonEmpty } from "../lib/schemas";
import { apiErrorMessage } from "../lib/apiError";
import { useAuth } from "../lib/auth";

const suiteSchema = z.object({
  name: nonEmpty("Suite name"),
  description: z.string().optional(),
});
type SuiteValues = z.infer<typeof suiteSchema>;

export function ProjectDetail() {
  const { t } = useTranslation();
  const isManager = useAuth((s) => s.user?.role === "MANAGER" || s.user?.role === "ADMIN");
  const { id } = useParams();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useZodForm<SuiteValues>(suiteSchema, {
    defaultValues: { name: "", description: "" },
  });

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => (await api.get(`/projects/${id}`)).data,
    enabled: !!id,
  });

  const createSuite = useMutation({
    mutationFn: async (values: SuiteValues) =>
      (await api.post("/suites", {
        projectId: id,
        name: values.name,
        description: values.description || null,
      }, { silent: true })).data,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["project", id] });
      setOpen(false);
      form.reset({ name: "", description: "" });
      setSubmitError(null);
      toast.success(t("common.saved"));
      logger.info("suite created", { suiteId: data.id, projectId: id });
    },
    onError: (e: unknown) => {
      logger.warn("suite creation failed", { err: e });
      setSubmitError(apiErrorMessage(e, t("common.something_went_wrong")));
    },
  });

  if (isLoading) return <PageLoader />;
  if (!project) return null;

  function closeForm() {
    setOpen(false);
    form.reset({ name: "", description: "" });
    setSubmitError(null);
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/projects"
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-2"
          >
            <ArrowLeft size={12} /> {t("projects.back_to_projects")}
          </Link>
          <div className="text-xs font-semibold text-brand-600 mb-1">{project.key}</div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          {project.description && <p className="text-sm text-slate-500 mt-1">{project.description}</p>}
        </div>
        <div className="flex gap-2">
          <Link to={`/projects/${project.id}/milestones`} className="btn-secondary">{t("projects.milestones")}</Link>
          <Link to={`/projects/${project.id}/requirements`} className="btn-secondary">{t("requirements.title")}</Link>
          {isManager && (
            <Link to={`/projects/${project.id}/import`} className="btn-secondary">
              <FileSpreadsheet size={16} /> {t("import.button")}
            </Link>
          )}
          {isManager && <Link to={`/projects/${project.id}/settings`} className="btn-secondary">{t("projects.settings")}</Link>}
          <Link to={`/runs?projectId=${project.id}`} className="btn-secondary">{t("projects.test_runs")}</Link>
          <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> {t("projects.new_suite")}</button>
        </div>
      </header>

      {open && (
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => createSuite.mutate(values))}
          className="card p-5 space-y-3"
        >
          <Field name="name" label={t("projects.suite_name")} error={form.formState.errors.name?.message}>
            <input className="input" autoFocus {...form.register("name")} />
          </Field>
          <Field name="description" label={t("common.description")} error={form.formState.errors.description?.message}>
            <textarea className="input" rows={2} {...form.register("description")} />
          </Field>
          {submitError && <div role="alert" className="text-sm text-red-600">{submitError}</div>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary" onClick={closeForm}>{t("common.cancel")}</button>
            <button type="submit" className="btn-primary" disabled={createSuite.isPending}>
              {createSuite.isPending ? t("common.please_wait") : t("common.create")}
            </button>
          </div>
        </form>
      )}

      <div>
        <h2 className="font-semibold mb-3">{t("projects.test_suites")}</h2>
        {project.suites.length === 0 ? (
          <div className="card p-10 text-center text-slate-500">{t("projects.no_suites")}</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {project.suites.map((s: any) => (
              <Link key={s.id} to={`/suites/${s.id}`} className="card p-4 hover:border-brand-500 flex items-center gap-3">
                <FolderTree size={20} className="text-brand-600" />
                <div className="flex-1">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-slate-500">
                    {t("suites.cases_total", { count: s.totalCases })}
                    {s.children.length > 0 && ` · ${t("suites.sub_suites_total", { count: s.children.length })}`}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
