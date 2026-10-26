import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { Spinner } from "./Spinner";
import { useConfigOptions, ConfigKind, ConfigOption } from "../lib/configOptions";
import { logger } from "../lib/logger";
import { useConfirm } from "./ui/ConfirmDialog";

type Props = { canEdit: boolean };

const KINDS: ConfigKind[] = ["PLATFORM", "CONNECTIVITY", "LOCALE"];

export function TestRunOptionsPanel({ canEdit }: Props) {
  const { t } = useTranslation();
  const { data: options = [] } = useConfigOptions();
  const [showDeleted, setShowDeleted] = useState(false);

  return (
    <section className="card p-5 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">{t("run_options.title")}</h2>
          <p className="text-xs text-slate-500 mt-1">{t("run_options.subtitle")}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          {t("run_options.show_deleted")}
        </label>
      </header>

      <div className="grid gap-5 md:grid-cols-3">
        {KINDS.map((kind) => (
          <KindColumn
            key={kind}
            kind={kind}
            options={options.filter((o) => o.kind === kind)}
            showDeleted={showDeleted}
            canEdit={canEdit}
          />
        ))}
      </div>
    </section>
  );
}

function KindColumn({
  kind,
  options,
  showDeleted,
  canEdit,
}: {
  kind: ConfigKind;
  options: ConfigOption[];
  showDeleted: boolean;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const confirmDialog = useConfirm();
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["test-config-options"] });

  const create = useMutation({
    mutationFn: async () =>
      (await api.post("/test-config-options", {
        kind,
        code: newCode.trim(),
        label: newLabel.trim(),
      }, { silent: true })).data,
    onSuccess: () => {
      logger.info("test config option added", { kind, code: newCode.trim() });
      setNewCode("");
      setNewLabel("");
      setErr(null);
      invalidate();
      toast.success(t("run_options.added"));
    },
    onError: (e: any) => {
      const code = e.response?.data?.error ?? "save_failed";
      setErr(code);
    },
  });

  const softDelete = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/test-config-options/${id}`)).data,
    onSuccess: (_d, id) => {
      logger.info("test config option removed", { id });
      invalidate();
      toast.success(t("run_options.removed"));
    },
  });

  const restore = useMutation({
    mutationFn: async (id: string) =>
      (await api.patch(`/test-config-options/${id}`, { restore: true })).data,
    onSuccess: (_d, id) => {
      logger.info("test config option restored", { id });
      invalidate();
      toast.success(t("run_options.restored"));
    },
  });

  async function onDelete(o: ConfigOption) {
    if (!(await confirmDialog({ title: t("run_options.confirm_remove", { label: o.label }), tone: "warning" }))) return;
    softDelete.mutate(o.id);
  }

  const visible = options
    .filter((o) => (showDeleted ? true : !o.deletedAt))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
        {t(`run_options.kind.${kind}`)}
      </h3>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800 rounded border border-slate-200 dark:border-slate-700">
        {visible.length === 0 && (
          <li className="p-3 text-xs text-slate-500">{t("run_options.empty")}</li>
        )}
        {visible.map((o) => (
          <li
            key={o.id}
            className={`flex items-center justify-between gap-2 px-3 py-2 ${o.deletedAt ? "opacity-60" : ""}`}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{o.label}</div>
              <div className="text-[0.6875rem] text-slate-500 font-mono">{o.code}</div>
            </div>
            {canEdit && (
              o.deletedAt ? (
                <button
                  className="btn-secondary text-xs"
                  onClick={() => restore.mutate(o.id)}
                  disabled={restore.isPending && restore.variables === o.id}
                  title={t("run_options.restore")}
                >
                  {restore.isPending && restore.variables === o.id
                    ? <Spinner size={12} className="text-slate-600" />
                    : <RotateCcw size={12} />}
                </button>
              ) : (
                <button
                  className="btn-secondary text-xs text-red-600"
                  onClick={() => onDelete(o)}
                  disabled={softDelete.isPending && softDelete.variables === o.id}
                  title={t("run_options.remove")}
                >
                  {softDelete.isPending && softDelete.variables === o.id
                    ? <Spinner size={12} className="text-red-600" />
                    : <Trash2 size={12} />}
                </button>
              )
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-[0.6875rem] font-semibold text-slate-500 uppercase tracking-wide">
            {t("run_options.add_new")}
          </div>
          <div>
            <label className="block text-[0.6875rem] text-slate-500 mb-1">
              {t("run_options.code_label")}
            </label>
            <input
              className="input text-xs font-mono"
              placeholder={t("run_options.code_hint", { example: kind === "LOCALE" ? "pt" : "LINUX" })}
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[0.6875rem] text-slate-500 mb-1">
              {t("run_options.label_label")}
            </label>
            <input
              className="input text-xs"
              placeholder={t("run_options.label_hint", { example: kind === "LOCALE" ? "Portuguese" : "Linux" })}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </div>
          <button
            className="btn-primary text-xs w-full"
            disabled={!newCode.trim() || !newLabel.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? <Spinner size={12} className="text-white" /> : <Plus size={12} />}
            {t("run_options.add_button")}
          </button>
          {err && (
            <div className="text-xs text-red-600">
              {t(`errors.${err}`, { defaultValue: t("common.save_failed") })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
