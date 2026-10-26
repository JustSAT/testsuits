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
  title: nonEmpty("Case title"),
  suiteId: nonEmpty("Suite"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
});
type Values = z.infer<typeof schema>;

type Props = {
  tree: CaseTree;
  defaultSuiteId?: string;
  onClose: () => void;
  onCreated: (caseId: string) => void;
};

/** Quick "new test case": title, suite and priority; details are edited on the case page. */
export function CaseCreateDialog({ tree, defaultSuiteId = "", onClose, onCreated }: Props) {
  const { t } = useTranslation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useZodForm<Values>(schema, { defaultValues: { title: "", suiteId: defaultSuiteId, priority: "MEDIUM" } });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const create = useMutation({
    mutationFn: async (v: Values) => (await api.post("/cases", v, { silent: true })).data,
    onSuccess: (c, v) => {
      logger.info("case created", { caseId: c.id, suiteId: v.suiteId, priority: v.priority });
      toast.success(t("common.saved"));
      onCreated(c.id);
    },
    onError: (e: unknown) => {
      logger.warn("case creation failed", { err: String(e) });
      setSubmitError(apiErrorMessage(e, t("common.something_went_wrong")));
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="case-dialog-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => create.mutate(v))}
        className="w-full max-w-lg space-y-4 rounded-lg bg-white p-6 shadow-xl dark:border dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-3">
          <h2 id="case-dialog-title" className="text-lg font-semibold">{t("repository.create_case")}</h2>
          <button type="button" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" aria-label={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <Field name="title" label={t("suites.case_title")} error={form.formState.errors.title?.message}>
          <input className="input" autoFocus {...form.register("title")} />
        </Field>
        <Field name="suiteId" label={t("repository.suite")} error={form.formState.errors.suiteId?.message}>
          <select className="input" {...form.register("suiteId")}>
            <option value="">{t("repository.select_suite")}</option>
            {parentOptions(tree).map((o) => (
              <option key={o.id} value={o.id}>{`${"  ".repeat(o.depth)}${o.name}`}</option>
            ))}
          </select>
        </Field>
        <Field name="priority" label={t("suites.priority")}>
          <select className="input" {...form.register("priority")}>
            {(["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).map((p) => (
              <option key={p} value={p}>{t(`priority.${p}`)}</option>
            ))}
          </select>
        </Field>
        {submitError && <div role="alert" className="text-sm text-red-600">{submitError}</div>}
        <footer className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {create.isPending ? t("common.please_wait") : t("common.create")}
          </Button>
        </footer>
      </form>
    </div>
  );
}
