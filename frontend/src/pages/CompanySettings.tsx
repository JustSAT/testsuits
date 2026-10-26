import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { PasswordInput } from "../components/PasswordInput";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { Spinner } from "../components/Spinner";
import { TestRunOptionsPanel } from "../components/TestRunOptionsPanel";
import { CompanyProfileCard } from "../components/CompanyProfileCard";

type CompanyJiraConfig = {
  baseUrl: string;
  email: string;
  defaultIssueType: string;
  summaryTemplate?: string | null;
  descriptionTemplate?: string | null;
  enabled: boolean;
  hasToken: boolean;
};

export function CompanySettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const confirmDialog = useConfirm();
  const isManager = user?.role === "MANAGER";

  const [form, setForm] = useState({
    baseUrl: "",
    email: "",
    apiToken: "",
    defaultIssueType: "Bug",
    summaryTemplate: "",
    descriptionTemplate: "",
    enabled: true,
  });
  const [testResult, setTestResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { data: config } = useQuery<CompanyJiraConfig | null>({
    queryKey: ["jira-config"],
    queryFn: async () => (await api.get(`/jira/config`)).data,
  });

  const { data: defaults } = useQuery({
    queryKey: ["jira-defaults"],
    queryFn: async () => (await api.get(`/jira/defaults/templates`)).data,
  });

  useEffect(() => {
    if (config) {
      setForm({
        baseUrl: config.baseUrl ?? "",
        email: config.email ?? "",
        apiToken: "",
        defaultIssueType: config.defaultIssueType ?? "Bug",
        summaryTemplate: config.summaryTemplate ?? "",
        descriptionTemplate: config.descriptionTemplate ?? "",
        enabled: config.enabled ?? true,
      });
    }
  }, [config?.baseUrl, config?.email, config?.summaryTemplate, config?.descriptionTemplate]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form } as any;
      if (!payload.apiToken) delete payload.apiToken;
      if (!payload.summaryTemplate) payload.summaryTemplate = null;
      if (!payload.descriptionTemplate) payload.descriptionTemplate = null;
      return (await api.put(`/jira/config`, payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jira-config"] });
      setErr(null);
      setForm((f) => ({ ...f, apiToken: "" }));
      toast.success(t("common.saved"));
      logger.info("jira company config saved");
    },
    onError: (e: any) => {
      logger.warn("jira config save failed", { err: e });
      const msg = e.response?.data?.error ?? t("common.something_went_wrong");
      setErr(msg);
      toast.error(msg);
    },
  });

  const test = useMutation({
    mutationFn: async () => (await api.post(`/jira/test`)).data,
    onSuccess: (data) => {
      setTestResult(t("jira.connected_as", { name: data.connectedAs, email: data.email }));
      logger.info("jira test connection successful");
    },
    onError: (e: any) => setTestResult(`${e.response?.data?.error ?? "failed"}`),
  });

  const remove = useMutation({
    mutationFn: async () => api.delete(`/jira/config`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jira-config"] });
      toast.success(t("jira.config_removed"));
      logger.info("jira config removed");
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  function useDefaultTemplates() {
    if (!defaults) return;
    setForm((f) => ({ ...f, summaryTemplate: defaults.summary, descriptionTemplate: defaults.description }));
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <div className="text-xs text-slate-500">{user?.company?.name}</div>
        <h1 className="text-2xl font-bold">{t("company.settings_title")}</h1>
        <p className="text-sm text-slate-500">{t("company.settings_subtitle")}</p>
      </header>

      {(user?.role === "MANAGER" || user?.role === "ADMIN") && <CompanyProfileCard />}

      <form noValidate onSubmit={onSubmit} className="card p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("jira.integration")}</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} disabled={!isManager} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            {t("jira.enabled")}
          </label>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded p-3">
          {t("jira.company_level_hint")}
        </p>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">{t("jira.credentials")}</h3>
          <div>
            <label className="label">{t("jira.base_url")}</label>
            <input className="input" placeholder={t("jira.base_url_placeholder")} value={form.baseUrl} disabled={!isManager}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t("jira.account_email")}</label>
              <input type="email" className="input" value={form.email} disabled={!isManager}
                onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div>
              <label className="label">
                {t("jira.api_token")} {config?.hasToken && <span className="text-slate-400">{t("jira.api_token_stored")}</span>}
              </label>
              <PasswordInput className="input" value={form.apiToken} disabled={!isManager}
                onChange={(e) => setForm({ ...form, apiToken: (e.target as HTMLInputElement).value })}
                placeholder={config?.hasToken ? "••••••••" : ""}
                required={!config?.hasToken} />
            </div>
          </div>
          <div>
            <label className="label">{t("jira.default_issue_type")}</label>
            <input className="input" value={form.defaultIssueType} disabled={!isManager}
              onChange={(e) => setForm({ ...form, defaultIssueType: e.target.value })}
              placeholder={t("jira.default_issue_type_placeholder")} />
            <p className="text-xs text-slate-500 mt-1">{t("jira.default_issue_type_help")}</p>
          </div>
          <p className="text-xs text-slate-500">
            {t("jira.token_help")}{" "}
            <a className="text-brand-600 hover:underline" target="_blank" rel="noreferrer"
              href="https://id.atlassian.com/manage-profile/security/api-tokens">
              id.atlassian.com/manage-profile/security/api-tokens
            </a>
          </p>
        </section>

        <section className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">{t("jira.issue_template")}</h3>
            <button type="button" className="btn-secondary text-xs" onClick={useDefaultTemplates}>{t("jira.use_defaults")}</button>
          </div>
          <p className="text-xs text-slate-500">{t("jira.template_help")}</p>
          <div>
            <label className="label">{t("jira.summary_template")}</label>
            <input className="input" value={form.summaryTemplate} placeholder={defaults?.summary ?? ""} disabled={!isManager}
              onChange={(e) => setForm({ ...form, summaryTemplate: e.target.value })} />
          </div>
          <div>
            <label className="label">{t("jira.description_template")}</label>
            <textarea className="input font-mono text-xs" rows={12} value={form.descriptionTemplate} placeholder={defaults?.description ?? ""} disabled={!isManager}
              onChange={(e) => setForm({ ...form, descriptionTemplate: e.target.value })} />
            <p className="text-xs text-slate-500 mt-1">{t("jira.markdown_note")}</p>
          </div>
        </section>

        {err && <div className="text-sm text-red-600">{err}</div>}
        {testResult && <div className="text-sm">{testResult}</div>}

        <div className="flex gap-2 justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
          {isManager && config && (
            <button
              type="button"
              className="btn-secondary text-red-600"
              disabled={remove.isPending}
              onClick={async () => { if (await confirmDialog({ title: t("jira.remove_confirm"), confirmLabel: t("common.delete"), tone: "danger" })) remove.mutate(); }}
            >
              {remove.isPending && <Spinner size={14} className="text-red-600" />}
              {t("jira.remove")}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            disabled={!config || test.isPending}
            onClick={() => test.mutate()}
          >
            {test.isPending && <Spinner size={14} className="text-slate-600" />}
            {t("jira.test_connection")}
          </button>
          {isManager && (
            <button type="submit" className="btn-primary" disabled={save.isPending}>
              {save.isPending && <Spinner size={14} className="text-white" />}
              {t("common.save")}
            </button>
          )}
        </div>
      </form>

      <TestRunOptionsPanel canEdit={!!isManager} />
    </div>
  );
}
