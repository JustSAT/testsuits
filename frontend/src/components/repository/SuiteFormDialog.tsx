import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { X } from "lucide-react";
import { api } from "../../lib/api";
import { logger } from "../../lib/logger";
import { useZodForm } from "../../lib/useZodForm";
import { nonEmpty } from "../../lib/schemas";
import { apiErrorMessage } from "../../lib/apiError";
import { parentOptions, type CaseTree } from "../../lib/caseTree";
import { Field } from "../Field";
import { Button } from "../ui/Button";


const schema = z.object({
  name: nonEmpty("Suite name"),
  parentId: z.string(),
  description: z.string().optional(),
});
type Values = z.infer<typeof schema>;

type Props = {
  projectId: string;
  tree: CaseTree;
  /** Editing this suite; otherwise a new suite is created. */
  suiteId?: string;
  /** Parent preselected for a new suite ("" = project root). */
  defaultParentId?: string;
  onClose: () => void;
  onSaved: (suiteId: string) => void;
};

/** Create or edit a suite: name, parent suite and description (Qase's "Create suite"). */
export function SuiteFormDialog({ projectId, tree, suiteId, defaultParentId = "", onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const editing = suiteId ? tree.byId.get(suiteId) : undefined;
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useZodForm<Values>(schema, {
    defaultValues: {
      name: editing?.name ?? "",
      parentId: editing ? editing.parentId ?? "" : defaultParentId,
      description: editing?.description ?? "",
    },
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: async (values: Values) => {
      const body = { name: values.name, parentId: values.parentId || null, description: values.description || null };
      return editing
        ? (await api.patch(`/suites/${editing.id}`, body, { silent: true })).data
        : (await api.post("/suites", { projectId, ...body }, { silent: true })).data;
    },
    onSuccess: (suite) => {
      logger.info(editing ? "suite updated" : "suite created", { suiteId: suite.id, projectId });
      toast.success(t("common.saved"));
      onSaved(suite.id);
    },
    onError: (e: unknown) => {
      logger.warn(editing ? "suite update failed" : "suite creation failed", { projectId, err: String(e) });
      setSubmitError(apiErrorMessage(e, t("common.something_went_wrong")));
    },
  });

  const options = parentOptions(tree, editing?.id);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="suite-dialog-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => save.mutate(v))}
        className="w-full max-w-lg space-y-4 rounded-lg bg-white p-6 shadow-xl dark:border dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-3">
          <h2 id="suite-dialog-title" className="text-lg font-semibold">
            {editing ? t("repository.edit_suite") : t("repository.create_suite")}
          </h2>
          <button type="button" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <Field name="name" label={t("projects.suite_name")} error={form.formState.errors.name?.message}>
          <input className="input" autoFocus placeholder={t("repository.suite_name_placeholder")} {...form.register("name")} />
        </Field>
        <Field name="parentId" label={t("repository.parent_suite")}>
          <select className="input" {...form.register("parentId")}>
            <option value="">{t("repository.project_root")}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{`${"  ".repeat(o.depth)}${o.name}`}</option>
            ))}
          </select>
        </Field>
        <Field name="description" label={t("common.description")}>
          <textarea className="input" rows={3} {...form.register("description")} />
        </Field>
        {submitError && <div role="alert" className="text-sm text-red-600">{submitError}</div>}
        <footer className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? t("common.please_wait") : editing ? t("common.save") : t("common.create")}
          </Button>
        </footer>
      </form>
    </div>
  );
}
