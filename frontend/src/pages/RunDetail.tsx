import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ChangeEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ParameterTable, StepsView } from "../components/case/StepsView";
import { Upload, Download, Trash2, ExternalLink, Bug, FileDown, Link as LinkIcon, Archive, RotateCcw, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { execStatusColors, runStatusColors } from "../lib/status";
import { Badge } from "../components/ui/Badge";
import { Comments } from "../components/Comments";
import { ActivityFeed } from "../components/ActivityFeed";
import { PageLoader, Spinner } from "../components/Spinner";
import { RichEditor } from "../components/RichEditor";
import { RunResultMatrix } from "../components/RunResultMatrix";
import { useAuth } from "../lib/auth";
import { useConfirm } from "../components/ui/ConfirmDialog";
import { logger } from "../lib/logger";

const STATUSES = ["PENDING", "PASSED", "FAILED", "BLOCKED", "SKIPPED"] as const;

export function RunDetail() {
  const { t } = useTranslation();
  const { id } = useParams();
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const isManager = user?.role === "MANAGER" || user?.role === "ADMIN";
  const confirmDialog = useConfirm();
  const [selected, setSelected] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [failureReason, setFailureReason] = useState("");
  const [actualResult, setActualResult] = useState("");
  const [duration, setDuration] = useState<string>("");
  const [jiraErr, setJiraErr] = useState<string | null>(null);
  const [linkKey, setLinkKey] = useState("");
  const [filter, setFilter] = useState<string>("ALL");

  const { data: run, isLoading } = useQuery({
    queryKey: ["run", id],
    queryFn: async () => (await api.get(`/runs/${id}`)).data,
    enabled: !!id,
  });

  const { data: execution } = useQuery({
    queryKey: ["execution", selected],
    queryFn: async () => (await api.get(`/executions/${selected}`)).data,
    enabled: !!selected,
  });

  const { data: jiraConfig } = useQuery({
    queryKey: ["jira-config", run?.projectId],
    queryFn: async () => (await api.get(`/jira/projects/${run.projectId}/binding`)).data,
    enabled: !!run?.projectId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/users")).data,
  });

  useEffect(() => {
    if (execution) {
      setNotes(execution.notes ?? "");
      setFailureReason(execution.failureReason ?? "");
      setActualResult(execution.actualResult ?? "");
      setDuration(execution.durationMinutes ? String(execution.durationMinutes) : "");
      setJiraErr(null);
      setLinkKey("");
    }
  }, [execution?.id]);

  const updateExec = useMutation({
    mutationFn: async (patch: Record<string, unknown>) =>
      (await api.patch(`/executions/${selected}`, patch)).data,
    onSuccess: () => {
      logger.info("execution updated", { executionId: selected });
      qc.invalidateQueries({ queryKey: ["run", id] });
      qc.invalidateQueries({ queryKey: ["execution", selected] });
      toast.success(t("common.saved"));
    },
  });

  const updateRun = useMutation({
    mutationFn: async (status: string) => (await api.patch(`/runs/${id}`, { status })).data,
    onSuccess: () => {
      logger.info("run status changed", { runId: id });
      qc.invalidateQueries({ queryKey: ["run", id] });
      toast.success(t("common.saved"));
    },
  });

  const archiveRun = useMutation({
    mutationFn: async (archive: boolean) =>
      (await api.patch(`/runs/${id}`, { status: archive ? "ARCHIVED" : "COMPLETED" })).data,
    onSuccess: (_data, archive) => {
      qc.invalidateQueries({ queryKey: ["run", id] });
      const msg = archive ? t("runs.archived_toast") : t("runs.unarchived_toast");
      toast.success(msg);
      logger.info(archive ? "run archived" : "run unarchived", { runId: id });
    },
  });

  async function onArchive() {
    if (await confirmDialog({ title: t("runs.archive_confirm"), tone: "warning" })) {
      archiveRun.mutate(true);
    }
  }

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      form.append("executionId", selected!);
      return (await api.post("/attachments", form)).data;
    },
    onSuccess: () => {
      logger.info("evidence uploaded", { runId: id });
      qc.invalidateQueries({ queryKey: ["execution", selected] });
      toast.success(t("runs.evidence_uploaded"));
    },
  });

  const deleteAttachment = useMutation({
    mutationFn: async (attId: string) => api.delete(`/attachments/${attId}`),
    onSuccess: (_data, attachmentId) => {
      logger.info("evidence deleted", { attachmentId });
      qc.invalidateQueries({ queryKey: ["execution", selected] });
      toast.success(t("common.deleted"));
    },
  });

  const createBug = useMutation({
    mutationFn: async () => (await api.post(`/jira/executions/${selected}/create-bug`)).data,
    onSuccess: () => {
      logger.info("jira bug created", { executionId: selected });
      setJiraErr(null);
      qc.invalidateQueries({ queryKey: ["run", id] });
      qc.invalidateQueries({ queryKey: ["execution", selected] });
      toast.success(t("jira.bug_created"));
    },
    onError: (e: any) => {
      logger.warn("jira bug creation failed", { err: e });
      setJiraErr(e.response?.data?.error ?? t("common.create_failed"));
    },
  });

  const linkBug = useMutation({
    mutationFn: async () => (await api.post(`/jira/executions/${selected}/link`, { jiraIssueKey: linkKey })).data,
    onSuccess: () => {
      logger.info("jira issue linked", { executionId: selected });
      qc.invalidateQueries({ queryKey: ["execution", selected] });
      qc.invalidateQueries({ queryKey: ["run", id] });
      toast.success(t("jira.linked"));
    },
  });

  const unlinkBug = useMutation({
    mutationFn: async (key: string) => {
      const data = (await api.post(`/jira/executions/${selected}/unlink`)).data;
      return { ...data, unlinkedKey: key };
    },
    onSuccess: (data: { unlinkedKey: string }) => {
      logger.info("jira issue unlinked", { executionId: selected, key: data.unlinkedKey });
      qc.invalidateQueries({ queryKey: ["execution", selected] });
      qc.invalidateQueries({ queryKey: ["run", id] });
      toast.success(t("jira.unlinked_key", { key: data.unlinkedKey }));
    },
  });

  async function onUnlinkExecution() {
    if (!execution?.jiraIssueKey) return;
    const confirmed = await confirmDialog({
      title: t("jira.unlink_confirm", { key: execution.jiraIssueKey }),
      body: t("jira.unlink_confirm_body"),
      tone: "warning",
    });
    if (confirmed) unlinkBug.mutate(execution.jiraIssueKey);
  }

  async function onDownload(attId: string) {
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

  function saveDetails() {
    updateExec.mutate({
      notes,
      failureReason,
      actualResult,
      durationMinutes: duration ? parseInt(duration, 10) : null,
    });
  }

  function exportCsv() {
    const token = localStorage.getItem("token");
    const base = (import.meta.env.VITE_API_URL as string) ?? "http://localhost:4000/api";
    fetch(`${base}/runs/${id}/export.csv`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `run-${id}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch((err) => { logger.error("CSV export failed", { err }); });
  }

  if (isLoading) return <PageLoader />;
  if (!run) return null;

  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {} as Record<string, number>);
  run.executions.forEach((e: any) => { counts[e.status]++; });
  const done = run.executions.length - counts.PENDING;
  const progress = run.executions.length > 0 ? Math.round((done / run.executions.length) * 100) : 0;
  const jiraReady = !!jiraConfig?.jiraProjectKey;

  const filteredExecs = filter === "ALL" ? run.executions : run.executions.filter((e: any) => e.status === filter);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link
            to={`/runs?projectId=${run.projectId}`}
            className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-2"
          >
            <ArrowLeft size={12} /> {t("runs.back_to_runs")}
          </Link>
          <div className="text-xs text-slate-500 mb-1 flex items-center gap-2 flex-wrap">
            <Link to={`/runs?projectId=${run.projectId}`} className="hover:underline">{run.project.name}</Link>
            {run.milestone && <Badge tone="violet">{run.milestone.name}</Badge>}
            {run.environment && <Badge tone="neutral">{run.environment}</Badge>}
            {run.dueDate && <span>{t("runs.due_on", { date: new Date(run.dueDate).toLocaleDateString() })}</span>}
          </div>
          <h1 className="text-2xl font-bold">{run.name}</h1>
          {run.description && <p className="text-sm text-slate-500 mt-1">{run.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${runStatusColors[run.status]}`}>{run.status.replace("_", " ")}</span>
          <button className="btn-secondary" onClick={exportCsv}><FileDown size={14} /> CSV</button>
          {run.status !== "COMPLETED" && run.status !== "ARCHIVED" && (
            <button
              className="btn-secondary"
              onClick={() => updateRun.mutate("COMPLETED")}
              disabled={updateRun.isPending}
            >
              {updateRun.isPending && <Spinner size={14} className="text-slate-600" />}
              {t("runs.mark_completed")}
            </button>
          )}
          {isManager && run.status !== "ARCHIVED" && (
            <button
              className="btn-secondary"
              onClick={onArchive}
              disabled={archiveRun.isPending}
            >
              {archiveRun.isPending && <Spinner size={14} className="text-slate-600" />}
              <Archive size={14} /> {t("runs.archive")}
            </button>
          )}
          {isManager && run.status === "ARCHIVED" && (
            <button
              className="btn-secondary"
              onClick={() => archiveRun.mutate(false)}
              disabled={archiveRun.isPending}
            >
              {archiveRun.isPending && <Spinner size={14} className="text-slate-600" />}
              <RotateCcw size={14} /> {t("runs.unarchive")}
            </button>
          )}
        </div>
      </header>

      <div className="card p-5">
        <div className="flex items-center justify-between text-sm mb-2">
          <span>{t("runs.executed_of", { done, total: run.executions.length })}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
          <div className="h-full bg-brand-600 dark:bg-brand-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          {(["ALL", ...STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`badge transition ${filter === s ? "ring-2 ring-brand-500 dark:ring-brand-400" : ""} ${s === "ALL" ? "bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200" : execStatusColors[s]}`}
            >
              {s}{s !== "ALL" && `: ${counts[s]}`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_1.2fr] gap-6">
        <div className="card divide-y divide-slate-100 dark:divide-slate-800 max-h-[70vh] overflow-auto">
          {filteredExecs.map((e: any) => (
            <button
              key={e.id}
              onClick={() => setSelected(e.id)}
              className={`w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between ${selected === e.id ? "bg-brand-50 dark:bg-brand-500/10" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{e.case.title}</div>
                <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
                  <span>{e.case.suite.name}</span>
                  {e.assignee && <span>→ {e.assignee.name}</span>}
                  {e.jiraIssueKey && <span className="text-amber-700 flex items-center gap-1"><Bug size={10} />{e.jiraIssueKey}</span>}
                </div>
              </div>
              <span className={`badge ${execStatusColors[e.status]} ml-2`}>{e.status}</span>
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {!execution ? (
            <div className="card p-10 text-center text-slate-500">{t("runs.select_case")}</div>
          ) : (
            <>
              <div className="card p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <h3 className="font-semibold">{execution.case.title}</h3>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500">{t("runs.assignee")}:</span>
                    <select
                      className="input text-xs py-1"
                      value={execution.assigneeId ?? ""}
                      disabled={updateExec.isPending}
                      onChange={(e) => updateExec.mutate({ assigneeId: e.target.value || null })}
                    >
                      <option value="">{t("common.unassigned")}</option>
                      {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                </div>
                {execution.case.preconditions && (
                  <div className="mt-3">
                    <div className="label">{t("cases.preconditions")}</div>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{execution.case.preconditions}</p>
                  </div>
                )}
                {(execution.case.parameters ?? []).length > 0 && (
                  <div className="mt-4 space-y-2">
                    <div className="label">{t("cases.parameters")}</div>
                    <ParameterTable parameters={execution.case.parameters} />
                  </div>
                )}
                <div className="mt-4 space-y-2">
                  <div className="label">{t("cases.steps")}</div>
                  <StepsView steps={execution.case.steps} />
                </div>
                {execution.case.postconditions && (
                  <div className="mt-3">
                    <div className="label">{t("cases.postconditions")}</div>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{execution.case.postconditions}</p>
                  </div>
                )}
              </div>

              {execution.results && execution.results.length > 0 ? (
                <>
                  <RunResultMatrix
                    executionId={execution.id}
                    runId={run.id}
                    results={execution.results}
                    jiraReady={jiraReady}
                  />
                  <div className="card p-5 space-y-3">
                    <div className="grid grid-cols-[1fr_140px] gap-3">
                      <div>
                        <label className="label">{t("runs.notes")}</label>
                        <textarea className="input" rows={2} value={notes}
                          onChange={(e) => setNotes(e.target.value)} />
                      </div>
                      <div>
                        <label className="label">{t("runs.duration_minutes")}</label>
                        <input type="number" min={1} className="input" value={duration}
                          onChange={(e) => setDuration(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button className="btn-secondary" onClick={saveDetails} disabled={updateExec.isPending}>
                        {updateExec.isPending && <Spinner size={14} className="text-slate-600" />}
                        {t("runs.save_details")}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="card p-5 space-y-4">
                    <div>
                      <div className="label">{t("runs.result")}</div>
                      <div className="flex gap-2 flex-wrap">
                        {STATUSES.filter((s) => s !== "PENDING").map((s) => (
                          <button
                            key={s}
                            className={`btn ${execution.status === s ? (s === "PASSED" ? "bg-emerald-600 text-white" : s === "FAILED" ? "bg-red-600 text-white" : "bg-brand-600 text-white dark:bg-brand-500") : "bg-white border border-slate-300 dark:border-slate-700 text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"}`}
                            onClick={() => updateExec.mutate({ status: s })}
                            disabled={updateExec.isPending}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="label">{t("runs.actual_result")}</label>
                      <RichEditor
                        value={actualResult}
                        onChange={setActualResult}
                        placeholder={t("runs.actual_placeholder")}
                        minHeight={72}
                      />
                    </div>

                    {execution.status === "FAILED" && (
                      <div>
                        <label className="label">{t("runs.why_failed")}</label>
                        <RichEditor
                          value={failureReason}
                          onChange={setFailureReason}
                          placeholder={t("runs.why_failed_placeholder")}
                          minHeight={96}
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-[1fr_140px] gap-3">
                      <div>
                        <label className="label">{t("runs.notes")}</label>
                        <textarea className="input" rows={2} value={notes}
                          onChange={(e) => setNotes(e.target.value)} />
                      </div>
                      <div>
                        <label className="label">{t("runs.duration_minutes")}</label>
                        <input type="number" min={1} className="input" value={duration}
                          onChange={(e) => setDuration(e.target.value)} />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <button className="btn-secondary" onClick={saveDetails} disabled={updateExec.isPending}>
                        {updateExec.isPending && <Spinner size={14} className="text-slate-600" />}
                        {t("runs.save_details")}
                      </button>
                    </div>
                  </div>

                  {execution.status === "FAILED" && (
                <div className="card p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2"><Bug size={16} /> {t("jira.title")}</h3>
                    {execution.jiraIssueKey ? (
                      <div className="flex items-center gap-2">
                        <a href={execution.jiraIssueUrl} target="_blank" rel="noreferrer"
                          className="btn-secondary text-brand-600">
                          {execution.jiraIssueKey} <ExternalLink size={12} />
                        </a>
                        <button
                          className="btn-secondary text-red-600"
                          onClick={onUnlinkExecution}
                          disabled={unlinkBug.isPending}
                        >
                          {unlinkBug.isPending && <Spinner size={14} className="text-red-600" />}
                          {t("jira.unlink")}
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-primary"
                        disabled={!jiraReady || createBug.isPending}
                        onClick={() => createBug.mutate()}
                      >
                        {createBug.isPending ? <Spinner size={14} className="text-white" /> : <Bug size={14} />}
                        {t("jira.create_bug")}
                      </button>
                    )}
                  </div>
                  {!execution.jiraIssueKey && (
                    <div className="flex items-center gap-2">
                      <input
                        className="input flex-1"
                        placeholder={t("jira.link_existing_placeholder")}
                        value={linkKey}
                        onChange={(e) => setLinkKey(e.target.value.toUpperCase())}
                      />
                      <button
                        className="btn-secondary"
                        disabled={!linkKey || linkBug.isPending}
                        onClick={() => linkBug.mutate()}
                      >
                        {linkBug.isPending ? <Spinner size={14} className="text-slate-600" /> : <LinkIcon size={14} />}
                        {t("jira.link")}
                      </button>
                    </div>
                  )}
                  {!jiraReady && !execution.jiraIssueKey && (
                    <div className="text-xs text-slate-500">
                      {t("jira.not_configured")}
                    </div>
                  )}
                  {jiraErr && <div className="text-sm text-red-600">{jiraErr}</div>}
                </div>
                  )}
                </>
              )}

              <div className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">{t("runs.evidence")}</h3>
                  <label className="btn-secondary cursor-pointer">
                    <Upload size={14} /> {t("cases.upload")}
                    <input type="file" className="hidden" onChange={onFile} />
                  </label>
                </div>
                {execution.attachments.length === 0 ? (
                  <div className="text-sm text-slate-500">{t("runs.no_evidence")}</div>
                ) : (
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {execution.attachments.map((a: any) => (
                      <li key={a.id} className="flex items-center justify-between py-2">
                        <div>
                          <div className="text-sm font-medium">{a.filename}</div>
                          <div className="text-xs text-slate-500">{t("runs.file_info", { size: (a.size / 1024).toFixed(1), name: a.uploadedBy.name })}</div>
                        </div>
                        <div className="flex gap-2">
                          <button className="btn-secondary" onClick={() => onDownload(a.id)}><Download size={14} /></button>
                          <button
                            className="btn-secondary text-red-600"
                            onClick={() => deleteAttachment.mutate(a.id)}
                            disabled={deleteAttachment.isPending && deleteAttachment.variables === a.id}
                          >
                            {deleteAttachment.isPending && deleteAttachment.variables === a.id
                              ? <Spinner size={14} className="text-red-600" />
                              : <Trash2 size={14} />}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="card p-5">
                <h3 className="font-semibold mb-3">{t("runs.comments")}</h3>
                <Comments target={{ executionId: execution.id }} />
              </div>
            </>
          )}

          <div className="card p-5">
            <h3 className="font-semibold mb-3">{t("runs.run_activity")}</h3>
            <ActivityFeed entityType="run" entityId={run.id} limit={20} />
          </div>
        </div>
      </div>
    </div>
  );
}
