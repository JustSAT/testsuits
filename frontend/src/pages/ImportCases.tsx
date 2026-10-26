import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../lib/api";
import { logger } from "../lib/logger";
import { PageLoader } from "../components/Spinner";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { Badge, BadgeTone } from "../components/ui/Badge";
import { apiErrorMessage } from "../lib/apiError";

type RowIssue = {
  sheet: string;
  row: number;
  code: string;
  column?: string;
  value?: string;
};

type Decision = {
  externalId: string;
  title: string;
  suitePath: string;
  action: "CREATE" | "UPDATE" | "SKIP";
  stepCount: number;
  row: number;
};

type Preview = {
  projectId: string;
  counts: { create: number; update: number; skip: number; suites: number; steps: number };
  issues: RowIssue[];
  skippedBlankRows: number;
  suitesToCreate: string[];
  decisions: Decision[];
  truncated: boolean;
  totalDecisions: number;
};

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  suitesCreated: number;
};

const actionTone: Record<Decision["action"], BadgeTone> = {
  CREATE: "success",
  UPDATE: "info",
  SKIP: "neutral",
};

export function ImportCases() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"SKIP" | "UPDATE">("SKIP");
  const [skipInvalidRows, setSkipInvalidRows] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => (await api.get(`/projects/${id}`)).data,
    enabled: !!id,
  });

  const downloadTemplate = useMutation({
    mutationFn: async () =>
      (await api.get("/imports/cases/template.xlsx", { responseType: "blob", silent: true })).data as Blob,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "suitesglobal-case-import-template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
      logger.info("case import template downloaded", { projectId: id });
    },
    onError: (e: unknown) => {
      logger.error("case import template download failed", { projectId: id, err: String(e) });
      toast.error(apiErrorMessage(e, t("common.something_went_wrong")));
    },
  });

  function buildForm(selected: File) {
    const form = new FormData();
    form.append("file", selected);
    form.append("projectId", String(id));
    form.append("duplicateStrategy", duplicateStrategy);
    form.append("skipInvalidRows", String(skipInvalidRows));
    return form;
  }

  const previewImport = useMutation({
    mutationFn: async (selected: File) =>
      (await api.post("/imports/cases/preview", buildForm(selected), { silent: true })).data as Preview,
    onSuccess: (data) => {
      setPreview(data);
      setSubmitError(null);
      logger.info("case import previewed", {
        projectId: id,
        counts: data.counts,
        issues: data.issues.length,
      });
    },
    onError: (e: unknown) => {
      setPreview(null);
      setSubmitError(apiErrorMessage(e, t("common.something_went_wrong")));
      logger.warn("case import preview failed", { projectId: id, err: String(e) });
    },
  });

  const runImport = useMutation({
    mutationFn: async (selected: File) =>
      (await api.post("/imports/cases", buildForm(selected), { silent: true })).data as ImportResult,
    onSuccess: (data) => {
      logger.info("case import committed", { projectId: id, ...data });
      toast.success(
        t("messages.IMPORT_SUCCESS", {
          created: data.created,
          updated: data.updated,
          suites: data.suitesCreated,
        }),
      );
      navigate(`/projects/${id}`);
    },
    onError: (e: unknown) => {
      setSubmitError(apiErrorMessage(e, t("common.something_went_wrong")));
      logger.warn("case import failed", { projectId: id, err: String(e) });
    },
  });

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setPreview(null);
    setSubmitError(null);
    setSkipInvalidRows(false);
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setSubmitError(null);
    setSkipInvalidRows(false);
    if (fileInput.current) fileInput.current.value = "";
  }

  /** Row-level problems are machine keys — always render them through t(). */
  function issueText(issue: RowIssue) {
    return t(`import.row_errors.${issue.code}`, {
      defaultValue: t("import.row_errors.UNKNOWN"),
      value: issue.value ?? "",
      column: issue.column ?? "",
    });
  }

  if (isLoading) return <PageLoader />;
  if (!project) return null;

  const hasIssues = (preview?.issues.length ?? 0) > 0;
  const importable = (preview?.counts.create ?? 0) + (preview?.counts.update ?? 0);
  const blockedByIssues = hasIssues && !skipInvalidRows;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            to={`/projects/${project.id}`}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <ArrowLeft size={12} /> {project.name}
          </Link>
        }
        eyebrow={project.key}
        title={t("import.title")}
        subtitle={t("import.subtitle")}
      />

      {/* Step 1 — template */}
      <section className="card p-5 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <FileSpreadsheet size={18} className="text-brand-600" />
          {t("import.step_template")}
        </h2>
        <p className="text-sm text-slate-500">{t("import.template_hint")}</p>
        <Button
          variant="secondary"
          leftIcon={<Download size={14} />}
          loading={downloadTemplate.isPending}
          onClick={() => downloadTemplate.mutate()}
        >
          {t("import.download_template")}
        </Button>
      </section>

      {/* Step 2 — file + options */}
      <section className="card p-5 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Upload size={18} className="text-brand-600" />
          {t("import.step_upload")}
        </h2>

        <div>
          <label className="label" htmlFor="import-file">{t("import.file")}</label>
          <input
            id="import-file"
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="input"
            onChange={onPick}
          />
          <p className="text-xs text-slate-500 mt-1">{t("import.file_hint")}</p>
        </div>

        <div>
          <label className="label" htmlFor="import-duplicates">{t("import.duplicate_strategy")}</label>
          <select
            id="import-duplicates"
            className="input"
            value={duplicateStrategy}
            onChange={(e) => {
              setDuplicateStrategy(e.target.value as "SKIP" | "UPDATE");
              setPreview(null);
            }}
          >
            <option value="SKIP">{t("import.strategy_skip")}</option>
            <option value="UPDATE">{t("import.strategy_update")}</option>
          </select>
          <p className="text-xs text-slate-500 mt-1">{t("import.strategy_hint")}</p>
        </div>

        <div className="flex gap-2">
          <Button
            variant="primary"
            loading={previewImport.isPending}
            disabled={!file}
            onClick={() => file && previewImport.mutate(file)}
          >
            {t("import.analyse")}
          </Button>
          {(file || preview) && (
            <Button variant="ghost" onClick={reset}>{t("import.reset")}</Button>
          )}
        </div>

        {submitError && <Alert tone="error">{submitError}</Alert>}
      </section>

      {/* Step 3 — review + commit */}
      {preview && (
        <section className="card p-5 space-y-4">
          <h2 className="font-semibold">{t("import.step_review")}</h2>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label={t("import.will_create")} value={preview.counts.create} tone="success" />
            <Stat label={t("import.will_update")} value={preview.counts.update} tone="info" />
            <Stat label={t("import.will_skip")} value={preview.counts.skip} tone="neutral" />
            <Stat label={t("import.new_suites")} value={preview.counts.suites} tone="brand" />
            <Stat label={t("import.total_steps")} value={preview.counts.steps} tone="neutral" />
          </div>

          {preview.skippedBlankRows > 0 && (
            <p className="text-xs text-slate-500">
              {t("import.blank_rows", { count: preview.skippedBlankRows })}
            </p>
          )}

          {preview.suitesToCreate.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">{t("import.suites_to_create")}</h3>
              <div className="flex flex-wrap gap-1.5">
                {preview.suitesToCreate.map((p) => (
                  <Badge key={p} tone="brand">{p}</Badge>
                ))}
              </div>
            </div>
          )}

          {hasIssues && (
            <div className="space-y-2">
              <Alert tone="warning" title={t("import.issues_title", { count: preview.issues.length })}>
                {t("import.issues_hint")}
              </Alert>
              <div className="max-h-64 overflow-y-auto rounded border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t("import.col_sheet")}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("import.col_row")}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("import.col_problem")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {preview.issues.map((issue, i) => (
                      <tr key={`${issue.sheet}-${issue.row}-${issue.code}-${i}`}>
                        <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">{issue.sheet}</td>
                        <td className="px-3 py-1.5 text-slate-500">{issue.row}</td>
                        <td className="px-3 py-1.5">{issueText(issue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={skipInvalidRows}
                  onChange={(e) => setSkipInvalidRows(e.target.checked)}
                />
                <span>
                  {t("import.skip_invalid")}
                  <span className="block text-xs text-slate-500">{t("import.skip_invalid_hint")}</span>
                </span>
              </label>
            </div>
          )}

          {preview.decisions.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">
                {t("import.rows_title", { count: preview.totalDecisions })}
              </h3>
              <div className="max-h-96 overflow-y-auto rounded border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">{t("import.col_row")}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("import.col_suite")}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("import.col_case")}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("import.col_steps")}</th>
                      <th className="text-left px-3 py-2 font-medium">{t("import.col_action")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {preview.decisions.map((d) => (
                      <tr key={`${d.row}-${d.externalId}`}>
                        <td className="px-3 py-1.5 text-slate-500">{d.row}</td>
                        <td className="px-3 py-1.5 text-slate-500">{d.suitePath}</td>
                        <td className="px-3 py-1.5">{d.title}</td>
                        <td className="px-3 py-1.5 text-slate-500">{d.stepCount}</td>
                        <td className="px-3 py-1.5">
                          <Badge tone={actionTone[d.action]}>{t(`import.action.${d.action}`)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.truncated && (
                <p className="text-xs text-slate-500 mt-1">
                  {t("import.truncated", { shown: preview.decisions.length, total: preview.totalDecisions })}
                </p>
              )}
            </div>
          )}

          {importable === 0 && <Alert tone="info">{t("import.nothing_to_import")}</Alert>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={reset}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              leftIcon={<Upload size={14} />}
              loading={runImport.isPending}
              disabled={!file || importable === 0 || blockedByIssues}
              onClick={() => file && runImport.mutate(file)}
            >
              {t("import.run_import", { count: importable })}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: BadgeTone }) {
  return (
    <div className="rounded border border-slate-200 dark:border-slate-700 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1">
        <Badge tone={tone}>{value}</Badge>
      </div>
    </div>
  );
}
