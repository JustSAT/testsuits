import { ChangeEvent, ReactNode, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ArrowRight, Copy, Download, ExternalLink, Pencil, Trash2, Upload, X } from "lucide-react";
import { api } from "../../lib/api";
import { logger } from "../../lib/logger";
import { apiErrorMessage } from "../../lib/apiError";
import { Markdown } from "../../lib/markdown";
import { execStatusTone, runStatusTone } from "../../lib/status";
import { TEST_LEVELS } from "../../lib/enums";
import { parentOptions, type CaseTree } from "../../lib/caseTree";
import { caseChanges, type CaseSnapshot, type Parameter, type Revision, type Step, type TrackedField } from "../../lib/caseModel";
import { Badge } from "../ui/Badge";
import { PageLoader, Spinner } from "../Spinner";
import { useConfirm } from "../ui/ConfirmDialog";
import { Comments } from "../Comments";
import { PriorityIcon } from "../PriorityIcon";
import { CaseEditor } from "./CaseEditor";
import { LinkedRequirements } from "./LinkedRequirements";
import { ParameterTable, StepsView } from "./StepsView";

const TABS = ["general", "properties", "runs", "history", "defects", "comments"] as const;
type Tab = (typeof TABS)[number];

type CustomField = { id: string; label: string; type: "text" | "textarea" | "number" | "select" | "checkbox"; required: boolean; options?: string[] };

type Props = {
  caseId: string;
  projectId: string;
  tree: CaseTree;
  isManager: boolean;
  onClose: () => void;
  /** The case changed (saved, moved, cloned); the repository should reload. */
  onChanged: () => void;
  onOpenCase: (caseId: string) => void;
  onDeleted: () => void;
};

/**
 * Qase-style case panel next to the repository: title, suite path and
 * edit / clone / delete on top, then General, Properties, Runs, History,
 * Defects and Comments tabs.
 */
export function CasePanel({ caseId, projectId, tree, isManager, onClose, onChanged, onOpenCase, onDeleted }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("general");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setTab("general");
    setEditing(false);
  }, [caseId]);

  const { data: testCase, isLoading } = useQuery({
    queryKey: ["case", caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}`)).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["case", caseId] });
    qc.invalidateQueries({ queryKey: ["case-revisions", caseId] });
    onChanged();
  };

  const clone = useMutation({
    mutationFn: async () => (await api.post(`/cases/${caseId}/clone`, {})).data,
    onSuccess: (cloned) => {
      logger.info("case cloned", { originalId: caseId, cloneId: cloned.id });
      toast.success(t("cases.saved"));
      onChanged();
      onOpenCase(cloned.id);
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("common.something_went_wrong"))),
  });

  const remove = useMutation({
    mutationFn: async () => api.delete(`/cases/${caseId}`),
    onSuccess: () => {
      logger.info("case deleted", { caseId });
      toast.success(t("common.deleted"));
      onDeleted();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("common.something_went_wrong"))),
  });

  const path = testCase ? tree.byId.get(testCase.suiteId)?.path.map((s) => s.name).join(" / ") : "";

  return (
    <aside className="sticky top-4 flex h-[calc(100vh-7rem)] w-[min(40rem,42%)] shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
      aria-label={testCase?.title}>
      {isLoading || !testCase ? (
        <PageLoader />
      ) : (
        <>
          <header className="space-y-3 border-b border-slate-200 px-5 pt-4 dark:border-slate-800">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold leading-snug">{testCase.title}</h2>
                <p className="mt-1 text-sm text-slate-500">{path}</p>
              </div>
              <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("common.close")} onClick={onClose}>
                <X size={18} />
              </button>
            </div>
            {isManager && !editing && (
              <div className="flex gap-2">
                <IconButton label={t("cases.edit")} onClick={() => { setTab("general"); setEditing(true); }}><Pencil size={16} /></IconButton>
                <IconButton label={t("cases.clone")} onClick={() => clone.mutate()} disabled={clone.isPending}>
                  {clone.isPending ? <Spinner size={16} /> : <Copy size={16} />}
                </IconButton>
                <IconButton label={t("common.delete")} disabled={remove.isPending}
                  onClick={async () => { if (await confirm({ title: t("cases.delete_confirm"), confirmLabel: t("common.delete"), tone: "danger" })) remove.mutate(); }}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
            )}
            <nav className="-mb-px flex gap-4 overflow-x-auto" role="tablist">
              {TABS.map((k) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`whitespace-nowrap border-b-2 pb-2 text-sm font-medium ${tab === k ? "border-brand-600 text-brand-700 dark:text-brand-300" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"}`}>
                  {t(`case_panel.tabs.${k}`)}
                </button>
              ))}
            </nav>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === "general" && (editing ? (
              <CaseEditor
                testCase={{ ...testCase, parameters: (testCase.parameters ?? []) as Parameter[], steps: testCase.steps as Step[] }}
                projectId={projectId}
                onCancel={() => setEditing(false)}
                onSaved={() => { setEditing(false); refresh(); }}
              />
            ) : (
              <GeneralTab testCase={testCase} isManager={isManager} onChanged={refresh} />
            ))}
            {tab === "properties" && <PropertiesTab testCase={testCase} projectId={projectId} tree={tree} isManager={isManager} onChanged={refresh} />}
            {tab === "runs" && <RunsTab caseId={caseId} />}
            {tab === "history" && <HistoryTab caseId={caseId} testCase={testCase} />}
            {tab === "defects" && <DefectsTab caseId={caseId} />}
            {tab === "comments" && <Comments target={{ caseId }} />}
          </div>
        </>
      )}
    </aside>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function TextOrNotSet({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation();
  return value ? <Markdown source={value} className="text-sm text-slate-700 dark:text-slate-300" /> : <p className="text-sm text-slate-500">{t("case_panel.not_set")}</p>;
}

function GeneralTab({ testCase, isManager, onChanged }: { testCase: any; isManager: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("caseId", testCase.id);
      return (await api.post("/attachments", form)).data;
    },
    onSuccess: () => {
      logger.info("case attachment uploaded", { caseId: testCase.id });
      toast.success(t("cases.upload_done"));
      onChanged();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("common.something_went_wrong"))),
  });
  const removeAttachment = useMutation({
    mutationFn: async (attId: string) => api.delete(`/attachments/${attId}`),
    onSuccess: (_d, attachmentId) => {
      logger.info("case attachment deleted", { attachmentId });
      toast.success(t("common.deleted"));
      onChanged();
    },
  });
  async function download(attId: string) {
    try {
      const { data } = await api.get(`/attachments/${attId}/download`);
      window.open(data.url, "_blank");
    } catch (err) {
      logger.error("attachment download failed", { attachmentId: attId, err });
    }
  }
  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) upload.mutate(f);
    e.target.value = "";
  }

  const parameters = (testCase.parameters ?? []) as Parameter[];
  return (
    <div className="space-y-5">
      <Section title={t("common.description")}><TextOrNotSet value={testCase.description} /></Section>
      <Section title={t("cases.preconditions")}><TextOrNotSet value={testCase.preconditions} /></Section>
      <Section title={t("cases.postconditions")}><TextOrNotSet value={testCase.postconditions} /></Section>
      {parameters.length > 0 && <Section title={t("cases.parameters")}><ParameterTable parameters={parameters} /></Section>}
      <Section title={t("cases.steps")}><StepsView steps={testCase.steps as Step[]} /></Section>
      <Section title={t("cases.attachments")}>
        {testCase.attachments.length === 0 ? (
          <p className="text-sm text-slate-500">{t("cases.no_attachments")}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {testCase.attachments.map((a: any) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium">{a.filename}</div>
                  <div className="text-xs text-slate-500">{t("runs.file_info", { size: (a.size / 1024).toFixed(1), name: a.uploadedBy.name })}</div>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" aria-label={t("common.download")} onClick={() => download(a.id)}><Download size={14} /></button>
                  {isManager && (
                    <button type="button" className="btn-secondary text-red-600" aria-label={t("common.delete")} onClick={() => removeAttachment.mutate(a.id)}><Trash2 size={14} /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <label className="btn-secondary mt-2 cursor-pointer">
          <Upload size={14} /> {t("cases.upload")}
          <input type="file" className="hidden" onChange={onFile} />
        </label>
      </Section>
    </div>
  );
}

function PropertiesTab({ testCase, projectId, tree, isManager, onChanged }: { testCase: any; projectId: string; tree: CaseTree; isManager: boolean; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { data: customFields = [] } = useQuery<CustomField[]>({
    queryKey: ["custom-fields", projectId],
    queryFn: async () => (await api.get(`/projects/${projectId}/custom-fields`)).data,
  });
  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await api.patch(`/cases/${testCase.id}`, body, { silent: true })).data,
    onSuccess: (_d, body) => {
      logger.info("case property updated", { caseId: testCase.id, fields: Object.keys(body) });
      toast.success(t("cases.saved"));
      onChanged();
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("common.something_went_wrong"))),
  });
  const save = (body: Record<string, unknown>) => patch.mutate(body);
  const disabled = !isManager || patch.isPending;
  const fmt = (d: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "long", timeStyle: "short" }).format(new Date(d));

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        {t("case_panel.created_on", { date: fmt(testCase.createdAt) })} · {t("case_panel.updated_on", { date: fmt(testCase.updatedAt) })}
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Prop label={t("repository.suite")}>
          <select className="input" disabled={disabled} value={testCase.suiteId} onChange={(e) => save({ suiteId: e.target.value })}>
            {parentOptions(tree).map((o) => <option key={o.id} value={o.id}>{`${"  ".repeat(o.depth)}${o.name}`}</option>)}
          </select>
        </Prop>
        <Prop label={t("suites.priority")} icon={<PriorityIcon priority={testCase.priority} />}>
          <select className="input" disabled={disabled} value={testCase.priority} onChange={(e) => save({ priority: e.target.value })}>
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((p) => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
          </select>
        </Prop>
        <Prop label={t("test_level.label")}>
          <select className="input" disabled={disabled} value={testCase.testLevel} onChange={(e) => save({ testLevel: e.target.value })}>
            {TEST_LEVELS.map((l) => <option key={l} value={l}>{t(`test_level.${l}`)}</option>)}
          </select>
        </Prop>
        <Prop label={t("cases.estimated_minutes")}>
          <input type="number" min={1} className="input" disabled={disabled} defaultValue={testCase.estimatedMinutes ?? ""} key={`est-${testCase.estimatedMinutes}`}
            onBlur={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : null;
              if (v !== (testCase.estimatedMinutes ?? null)) save({ estimatedMinutes: v });
            }} />
        </Prop>
        <Prop label={t("cases.tags")} wide>
          <input className="input" disabled={disabled} defaultValue={testCase.tags.join(", ")} key={`tags-${testCase.tags.join(",")}`}
            onBlur={(e) => {
              const tags = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
              if (tags.join(",") !== testCase.tags.join(",")) save({ tags });
            }} />
        </Prop>
        <Prop label={t("cases.requirements")} wide>
          <textarea className="input" rows={2} disabled={disabled} defaultValue={(testCase.requirements ?? []).join("\n")} key={`req-${(testCase.requirements ?? []).join("|")}`}
            onBlur={(e) => {
              const requirements = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
              if (requirements.join("|") !== (testCase.requirements ?? []).join("|")) save({ requirements });
            }} />
        </Prop>
        {customFields.map((f) => {
          const v = testCase.customFieldValues?.[f.id];
          const set = (value: unknown) => save({ customFieldValues: { ...(testCase.customFieldValues ?? {}), [f.id]: value } });
          return (
            <Prop key={f.id} label={f.label + (f.required ? " *" : "")}>
              {f.type === "select" ? (
                <select className="input" disabled={disabled} value={(v as string) ?? ""} onChange={(e) => set(e.target.value || null)}>
                  <option value="">{t("case_panel.not_set")}</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.type === "checkbox" ? (
                <input type="checkbox" className="mt-2" disabled={disabled} checked={!!v} onChange={(e) => set(e.target.checked)} />
              ) : (
                <input className="input" type={f.type === "number" ? "number" : "text"} disabled={disabled} defaultValue={(v as string) ?? ""} key={`${f.id}-${v}`}
                  onBlur={(e) => {
                    const next = f.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value;
                    if (next !== (v ?? (f.type === "number" ? null : ""))) set(next);
                  }} />
              )}
            </Prop>
          );
        })}
      </div>
      <LinkedRequirements caseId={testCase.id} projectId={projectId} editing={isManager} linked={testCase.requirementLinks ?? []} />
      {testCase.cloneOf && (
        <p className="text-sm text-slate-500">{t("cases.cloned_from", { title: testCase.cloneOf.title })}</p>
      )}
    </div>
  );
}

function Prop({ label, icon, wide, children }: { label: string; icon?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <div className="label flex items-center gap-1.5">{icon}{label}</div>
      {children}
    </div>
  );
}

type Execution = {
  id: string;
  status: string;
  executedAt: string | null;
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  executedBy: { name: string } | null;
  run: { id: string; name: string; status: string; environment: string | null; createdAt: string };
  results: { id: string; status: string; platform: string | null; connectivity: string | null; locale: string; jiraIssueKey: string | null; jiraIssueUrl: string | null }[];
};

function useExecutions(caseId: string) {
  return useQuery<Execution[]>({
    queryKey: ["case-executions", caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/executions`)).data,
  });
}

function RunsTab({ caseId }: { caseId: string }) {
  const { t, i18n } = useTranslation();
  const { data = [], isLoading } = useExecutions(caseId);
  if (isLoading) return <PageLoader />;
  if (data.length === 0) return <p className="text-sm text-slate-500">{t("case_panel.no_runs")}</p>;
  const fmt = (d: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium" }).format(new Date(d));
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {data.map((e) => (
        <li key={e.id} className="flex items-center gap-3 py-2.5">
          <Badge tone={execStatusTone(e.status)}>{t(`status.${e.status}`)}</Badge>
          <div className="min-w-0 flex-1">
            <Link to={`/runs/${e.run.id}`} className="block truncate text-sm font-medium hover:underline">{e.run.name}</Link>
            <div className="text-xs text-slate-500">
              {fmt(e.run.createdAt)}{e.run.environment && ` · ${e.run.environment}`}{e.executedBy && ` · ${e.executedBy.name}`}
            </div>
          </div>
          <Badge tone={runStatusTone(e.run.status)} size="xs">{t(`run_status.${e.run.status}`)}</Badge>
        </li>
      ))}
    </ul>
  );
}

function DefectsTab({ caseId }: { caseId: string }) {
  const { t } = useTranslation();
  const { data = [], isLoading } = useExecutions(caseId);
  if (isLoading) return <PageLoader />;
  const defects = new Map<string, { key: string; url: string | null; runs: Set<string> }>();
  for (const e of data) {
    for (const ref of [{ key: e.jiraIssueKey, url: e.jiraIssueUrl }, ...e.results.map((r) => ({ key: r.jiraIssueKey, url: r.jiraIssueUrl }))]) {
      if (!ref.key) continue;
      const d = defects.get(ref.key) ?? { key: ref.key, url: ref.url, runs: new Set<string>() };
      d.runs.add(e.run.name);
      defects.set(ref.key, d);
    }
  }
  if (defects.size === 0) return <p className="text-sm text-slate-500">{t("case_panel.no_defects")}</p>;
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {[...defects.values()].map((d) => (
        <li key={d.key} className="py-2.5">
          {d.url ? (
            <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline dark:text-brand-300">
              {d.key} <ExternalLink size={12} />
            </a>
          ) : <span className="text-sm font-medium">{d.key}</span>}
          <div className="text-xs text-slate-500">{[...d.runs].join(", ")}</div>
        </li>
      ))}
    </ul>
  );
}

function HistoryTab({ caseId, testCase }: { caseId: string; testCase: CaseSnapshot }) {
  const { t, i18n } = useTranslation();
  const { data: revisions = [], isLoading } = useQuery<Revision[]>({
    queryKey: ["case-revisions", caseId],
    queryFn: async () => (await api.get(`/cases/${caseId}/revisions`)).data,
  });
  if (isLoading) return <PageLoader />;
  const entries = caseChanges(revisions, testCase);
  if (entries.length === 0) return <p className="text-sm text-slate-500">{t("cases.no_revisions")}</p>;
  const fmt = (d: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(d));
  const field = (f: TrackedField) => t(`case_panel.fields.${f}`);
  return (
    <ol className="space-y-5">
      {entries.map((e) => (
        <li key={e.id} className="space-y-2">
          <div>
            <p className="text-sm">
              <span className="font-semibold">{e.author ?? t("case_panel.someone")}</span>{" "}
              {t("case_panel.updated_fields", { count: e.changes.length })}{" "}
              <span className="font-semibold">{e.changes.map((c) => field(c.field)).join(", ")}</span>
            </p>
            <p className="text-xs text-slate-500">{fmt(e.at)}</p>
          </div>
          {e.changes.map((c) => (
            <div key={c.field} className="ml-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
              <div className="mb-1 text-xs font-semibold text-slate-500">{field(c.field)}</div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 text-sm">
                <ChangeValue value={c.before} field={c.field} tone="before" />
                <ArrowRight size={14} className="mt-1 text-slate-400" />
                <ChangeValue value={c.after} field={c.field} tone="after" />
              </div>
            </div>
          ))}
        </li>
      ))}
    </ol>
  );
}

function ChangeValue({ value, field, tone }: { value: unknown; field: TrackedField; tone: "before" | "after" }) {
  const { t } = useTranslation();
  const cls = tone === "before" ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-200" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200";
  let text: string;
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) text = t("case_panel.not_set");
  else if (field === "priority") text = t(`priority.${value}`);
  else if (field === "testLevel") text = t(`test_level.${value}`);
  else if (field === "steps") text = stepsText(value as Step[], t("cases.input_data"), t("cases.expected_result"));
  else if (field === "parameters") text = (value as Parameter[]).map((p) => `${p.title}: ${p.values.join(", ")}`).join("\n");
  else if (Array.isArray(value)) text = value.join(", ");
  else text = String(value);
  return <div className={`whitespace-pre-line rounded px-2 py-1 ${cls}`}>{text}</div>;
}

/** Steps as plain text for the history diff: action, input data, expected result and substeps. */
function stepsText(steps: Step[], dataLabel: string, expectedLabel: string): string {
  const lines: string[] = [];
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.action}`);
    if (s.data) lines.push(`   ${dataLabel}: ${s.data}`);
    if (s.expected && s.expected !== "—") lines.push(`   ${expectedLabel}: ${s.expected}`);
    (s.substeps ?? []).forEach((x, j) => {
      lines.push(`   ${i + 1}.${j + 1}. ${x.action}`);
      if (x.data) lines.push(`      ${dataLabel}: ${x.data}`);
      if (x.expected) lines.push(`      ${expectedLabel}: ${x.expected}`);
    });
  });
  return lines.join("\n");
}
