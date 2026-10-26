import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FolderTree, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { api } from "../lib/api";
import { logger } from "../lib/logger";
import { priorityTone } from "../lib/status";
import { PageLoader, Spinner } from "../components/Spinner";
import { Badge } from "../components/ui/Badge";
import { Field } from "../components/Field";
import { useZodForm } from "../lib/useZodForm";
import { nonEmpty } from "../lib/schemas";
import { apiErrorMessage } from "../lib/apiError";

const suiteSchema = z.object({ name: nonEmpty("Suite name") });
type SuiteValues = z.infer<typeof suiteSchema>;

const caseSchema = z.object({
  title: nonEmpty("Case title"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
});
type CaseValues = z.infer<typeof caseSchema>;

export function SuiteDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const qc = useQueryClient();
  const [openSuite, setOpenSuite] = useState(false);
  const [openCase, setOpenCase] = useState(false);
  const [suiteError, setSuiteError] = useState<string | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);

  const suiteForm = useZodForm<SuiteValues>(suiteSchema, { defaultValues: { name: "" } });
  const caseForm = useZodForm<CaseValues>(caseSchema, {
    defaultValues: { title: "", priority: "MEDIUM" },
  });

  const { data: suite, isLoading } = useQuery({
    queryKey: ["suite", id],
    queryFn: async () => (await api.get(`/suites/${id}`)).data,
    enabled: !!id,
  });

  const createSuite = useMutation({
    mutationFn: async (values: SuiteValues) =>
      (await api.post(
        "/suites",
        { projectId: suite.projectId, parentId: id, name: values.name },
        { silent: true },
      )).data,
    onSuccess: (_data, values) => {
      qc.invalidateQueries({ queryKey: ["suite", id] });
      setOpenSuite(false);
      suiteForm.reset({ name: "" });
      setSuiteError(null);
      toast.success(t("common.saved"));
      logger.info("sub-suite created", { parentSuiteId: id, name: values.name });
    },
    onError: (e: unknown) => {
      setSuiteError(apiErrorMessage(e, t("common.something_went_wrong")));
      logger.warn("sub-suite creation failed", { parentSuiteId: id, error: String(e) });
    },
  });

  const createCase = useMutation({
    mutationFn: async (values: CaseValues) =>
      (await api.post(
        "/cases",
        { suiteId: id, title: values.title, priority: values.priority },
        { silent: true },
      )).data,
    onSuccess: (_data, values) => {
      qc.invalidateQueries({ queryKey: ["suite", id] });
      setOpenCase(false);
      caseForm.reset({ title: "", priority: "MEDIUM" });
      setCaseError(null);
      toast.success(t("common.saved"));
      logger.info("case created", { suiteId: id, title: values.title, priority: values.priority });
    },
    onError: (e: unknown) => {
      setCaseError(apiErrorMessage(e, t("common.something_went_wrong")));
      logger.warn("case creation failed", { suiteId: id, error: String(e) });
    },
  });

  function closeSuiteForm() {
    setOpenSuite(false);
    suiteForm.reset({ name: "" });
    setSuiteError(null);
  }

  function closeCaseForm() {
    setOpenCase(false);
    caseForm.reset({ title: "", priority: "MEDIUM" });
    setCaseError(null);
  }

  if (isLoading) return <PageLoader />;
  if (!suite) return null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link to={`/projects/${suite.project.id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-brand-600">
          <ArrowLeft size={16} /> {suite.project.name}
        </Link>
        <h1 className="text-2xl font-bold">{suite.name}</h1>
        {suite.description && <p className="text-sm text-slate-500 mt-1">{suite.description}</p>}
      </header>

      <div className="flex gap-2">
        <button className="btn-secondary" onClick={() => setOpenSuite(true)}><Plus size={16} /> {t("suites.sub_suite")}</button>
        <button className="btn-primary" onClick={() => setOpenCase(true)}><Plus size={16} /> {t("suites.test_case")}</button>
      </div>

      {openSuite && (
        <form
          noValidate
          onSubmit={suiteForm.handleSubmit((values) => createSuite.mutate(values))}
          className="card p-5 space-y-3"
        >
          <Field
            name="name"
            label={t("projects.suite_name")}
            error={suiteForm.formState.errors.name?.message}
          >
            <input className="input" autoFocus {...suiteForm.register("name")} />
          </Field>
          {suiteError && <div role="alert" className="text-sm text-red-600">{suiteError}</div>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary" onClick={closeSuiteForm}>{t("common.cancel")}</button>
            <button type="submit" className="btn-primary" disabled={createSuite.isPending}>
              {createSuite.isPending && <Spinner size={14} className="text-white" />}
              {createSuite.isPending ? t("common.please_wait") : t("common.create")}
            </button>
          </div>
        </form>
      )}

      {openCase && (
        <form
          noValidate
          onSubmit={caseForm.handleSubmit((values) => createCase.mutate(values))}
          className="card p-5 space-y-3"
        >
          <Field
            name="title"
            label={t("suites.case_title")}
            error={caseForm.formState.errors.title?.message}
          >
            <input className="input" autoFocus {...caseForm.register("title")} />
          </Field>
          <Field
            name="priority"
            label={t("suites.priority")}
            error={caseForm.formState.errors.priority?.message}
          >
            <select className="input" {...caseForm.register("priority")}>
              <option value="LOW">{t("priority.LOW")}</option>
              <option value="MEDIUM">{t("priority.MEDIUM")}</option>
              <option value="HIGH">{t("priority.HIGH")}</option>
              <option value="CRITICAL">{t("priority.CRITICAL")}</option>
            </select>
          </Field>
          {caseError && <div role="alert" className="text-sm text-red-600">{caseError}</div>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn-secondary" onClick={closeCaseForm}>{t("common.cancel")}</button>
            <button type="submit" className="btn-primary" disabled={createCase.isPending}>
              {createCase.isPending && <Spinner size={14} className="text-white" />}
              {createCase.isPending ? t("common.please_wait") : t("common.create")}
            </button>
          </div>
        </form>
      )}

      {suite.children.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3">{t("suites.sub_suites")}</h2>
          <div className="grid md:grid-cols-2 gap-3">
            {suite.children.map((c: any) => (
              <Link key={c.id} to={`/suites/${c.id}`} className="card p-4 hover:border-brand-500 flex items-center gap-3">
                <FolderTree size={20} className="text-brand-600" />
                <div className="flex-1">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-slate-500">{t("suites.cases_total", { count: c.totalCases })}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="font-semibold mb-3">{t("suites.test_cases")}</h2>
        {suite.cases.length === 0 ? (
          <div className="card p-10 text-center text-slate-500">{t("suites.no_cases")}</div>
        ) : (
          <div className="card divide-y divide-slate-100 dark:divide-slate-800">
            {suite.cases.map((c: any) => (
              <Link key={c.id} to={`/cases/${c.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800">
                <div className="flex-1">
                  <div className="font-medium">{c.title}</div>
                  {c.tags.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {c.tags.map((t: string) => <Badge key={t} tone="neutral">{t}</Badge>)}
                    </div>
                  )}
                </div>
                <Badge tone={priorityTone(c.priority)}>{c.priority}</Badge>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
