import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { toast } from "sonner";
import { api } from "../lib/api";
import { logger } from "../lib/logger";
import { Field } from "../components/Field";
import { useZodForm } from "../lib/useZodForm";
import { nonEmpty } from "../lib/schemas";
import { apiErrorMessage } from "../lib/apiError";
import { milestoneStatusTone } from "../lib/status";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Alert } from "../components/ui/Alert";
import { badgeToneClasses } from "../components/ui/Badge";
import { useConfirm } from "../components/ui/ConfirmDialog";

const schema = z.object({
  name: nonEmpty("Name"),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.enum(["PLANNED", "ACTIVE", "RELEASED", "CANCELLED"]),
});
type Values = z.infer<typeof schema>;

const STATUS_OPTIONS = ["PLANNED", "ACTIVE", "RELEASED", "CANCELLED"] as const;

export function Milestones() {
  const { t } = useTranslation();
  const { id } = useParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useZodForm<Values>(schema, {
    defaultValues: { name: "", description: "", dueDate: "", status: "PLANNED" },
  });

  const { data: project } = useQuery({
    queryKey: ["project", id],
    queryFn: async () => (await api.get(`/projects/${id}`)).data,
    enabled: !!id,
  });

  const { data: milestones = [] } = useQuery({
    queryKey: ["milestones", id],
    queryFn: async () => (await api.get("/milestones", { params: { projectId: id } })).data,
    enabled: !!id,
  });

  const create = useMutation({
    mutationFn: async (values: Values) =>
      (await api.post("/milestones", {
        projectId: id,
        name: values.name,
        description: values.description || null,
        status: values.status,
        dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : null,
      }, { silent: true })).data,
    onSuccess: (_data, values) => {
      qc.invalidateQueries({ queryKey: ["milestones", id] });
      setOpen(false);
      form.reset({ name: "", description: "", dueDate: "", status: "PLANNED" });
      setSubmitError(null);
      logger.info("milestone created", { projectId: id, name: values.name, status: values.status });
    },
    onError: (e: unknown) => {
      setSubmitError(apiErrorMessage(e, t("common.something_went_wrong")));
      logger.warn("milestone creation failed", { projectId: id, error: String(e) });
    },
  });

  const remove = useMutation({
    mutationFn: async (mid: string) => api.delete(`/milestones/${mid}`),
    onSuccess: (_data, mid) => {
      qc.invalidateQueries({ queryKey: ["milestones", id] });
      toast.success(t("common.deleted"));
      logger.info("milestone removed", { milestoneId: mid, projectId: id });
    },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ mid, status }: { mid: string; status: string }) =>
      (await api.patch(`/milestones/${mid}`, { status })).data,
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["milestones", id] });
      toast.success(t("common.saved"));
      logger.info("milestone status updated", { milestoneId: variables.mid, status: variables.status, projectId: id });
    },
  });

  function closeForm() {
    setOpen(false);
    form.reset({ name: "", description: "", dueDate: "", status: "PLANNED" });
    setSubmitError(null);
  }

  return (
    <div className="space-y-6">
      {project && (
        <Link to={`/projects/${project.id}`} className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-brand-600">
          <ArrowLeft size={16} /> {project.name}
        </Link>
      )}
      <PageHeader
        title={t("milestones.title")}
        subtitle={t("milestones.subtitle")}
        actions={
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => setOpen(true)}>
            {t("milestones.new_milestone")}
          </Button>
        }
      />

      {open && (
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => create.mutate(values))}
          className="card p-5 space-y-3"
        >
          <Field name="name" label={t("common.name")} error={form.formState.errors.name?.message}>
            <input className="input" {...form.register("name")} />
          </Field>
          <Field name="description" label={t("common.description")} error={form.formState.errors.description?.message}>
            <textarea className="input" rows={2} {...form.register("description")} />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field name="dueDate" label={t("runs.due_date")} error={form.formState.errors.dueDate?.message}>
              <input type="date" className="input" {...form.register("dueDate")} />
            </Field>
            <Field name="status" label={t("common.status")} error={form.formState.errors.status?.message}>
              <select className="input" {...form.register("status")}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(`milestone_status.${s}`)}</option>)}
              </select>
            </Field>
          </div>
          {submitError && <Alert>{submitError}</Alert>}
          <div className="flex gap-2 justify-end">
            <Button type="button" onClick={closeForm}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              {t("common.create")}
            </Button>
          </div>
        </form>
      )}

      {milestones.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">{t("milestones.empty")}</div>
      ) : (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          {milestones.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between px-5 py-3">
              <div className="flex-1">
                <Link to={`/projects/${id}/runs?milestoneId=${m.id}`} className="font-medium hover:underline">{m.name}</Link>
                <div className="text-xs text-slate-500">
                  {t("milestones.runs_count", { count: m._count.runs })}
                  {m.dueDate && ` · ${t("milestones.due_on", { date: new Date(m.dueDate).toLocaleDateString() })}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className={`badge ${badgeToneClasses[milestoneStatusTone(m.status)]} cursor-pointer`}
                  value={m.status}
                  disabled={updateStatus.isPending && updateStatus.variables?.mid === m.id}
                  onChange={(e) => updateStatus.mutate({ mid: m.id, status: e.target.value })}
                >
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{t(`milestone_status.${s}`)}</option>)}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("common.delete")}
                  className="text-slate-400 hover:text-red-600"
                  loading={remove.isPending && remove.variables === m.id}
                  onClick={async () => {
                    if (await confirm({
                      title: t("milestones.delete_confirm"),
                      confirmLabel: t("common.delete"),
                      tone: "danger",
                    })) remove.mutate(m.id);
                  }}
                >
                  {!(remove.isPending && remove.variables === m.id) && <Trash2 size={16} />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
