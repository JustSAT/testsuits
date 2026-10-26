import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api } from "../lib/api";
import { logger } from "../lib/logger";
import { useAuth } from "../lib/auth";
import { apiErrorMessage } from "../lib/apiError";
import { PageLoader } from "../components/Spinner";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ActionMenu } from "../components/ui/ActionMenu";
import { useConfirm } from "../components/ui/ConfirmDialog";

type EnvType = "DYNAMIC" | "STATIC";
type Environment = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  type: EnvType;
  host: string;
  runCount: number;
  lastRunAt: string | null;
};

/** "Production server" → "production-server": the slug suggested while typing the title. */
function slugify(title: string) {
  return title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The current project's environments, Qase style: cards, search and a create/edit dialog. */
export function Environments() {
  const { t, i18n } = useTranslation();
  const { id: projectId = "" } = useParams();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const isManager = useAuth((s) => s.user?.role === "MANAGER" || s.user?.role === "ADMIN");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Environment | "new" | null>(null);

  const { data: environments = [], isLoading } = useQuery<Environment[]>({
    queryKey: ["environments", projectId],
    queryFn: async () => (await api.get("/environments", { params: { projectId } })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/environments/${id}`),
    onSuccess: (_d, id) => {
      logger.info("environment deleted", { environmentId: id, projectId });
      toast.success(t("common.deleted"));
      qc.invalidateQueries({ queryKey: ["environments", projectId] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, t("common.something_went_wrong"))),
  });

  if (isLoading) return <PageLoader />;
  const q = query.trim().toLowerCase();
  const shown = q ? environments.filter((e) => `${e.title} ${e.slug} ${e.host}`.toLowerCase().includes(q)) : environments;
  const fmt = (d: string) => new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium" }).format(new Date(d));

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("environments.title")}</h1>
      <div className="flex flex-wrap items-center gap-3">
        {isManager && (
          <button className="btn-primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> {t("environments.new")}
          </button>
        )}
        <div className="relative w-full max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-8" placeholder={t("environments.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      {environments.length === 0 ? (
        <div className="card p-10 text-center text-slate-500">{t("environments.empty")}</div>
      ) : shown.length === 0 ? (
        <p className="text-sm text-slate-500">{t("runs.picker.no_matches")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((e) => (
            <div key={e.id} className="card flex min-h-[10rem] flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <Badge tone={e.type === "STATIC" ? "neutral" : "brand"} size="xs">{t(`environments.type.${e.type}`)}</Badge>
                {isManager && (
                  <ActionMenu
                    label={t("common.actions")}
                    items={[
                      { key: "edit", icon: <Pencil size={15} />, label: t("common.edit"), onSelect: () => setEditing(e) },
                      {
                        key: "del", icon: <Trash2 size={15} />, label: t("common.delete"), danger: true,
                        onSelect: async () => {
                          if (await confirm({ title: t("environments.delete_confirm", { title: e.title }), body: t("environments.delete_body"), confirmLabel: t("common.delete") })) remove.mutate(e.id);
                        },
                      },
                    ]}
                  />
                )}
              </div>
              <h2 className="mt-2 text-lg font-semibold">{e.title}</h2>
              <p className="text-sm text-slate-500">{t("environments.slug")} <span className="font-medium text-slate-700 dark:text-slate-300">{e.slug}</span></p>
              <p className="truncate text-sm text-slate-500" title={e.host}>{e.host}</p>
              {e.description && <p className="mt-1 line-clamp-2 text-sm">{e.description}</p>}
              <p className="mt-auto pt-3 text-xs text-slate-500">
                {e.runCount === 0 ? t("environments.no_runs") : t("environments.runs", { count: e.runCount, date: fmt(e.lastRunAt!) })}
              </p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EnvironmentDialog
          projectId={projectId}
          environment={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["environments", projectId] }); }}
        />
      )}
    </div>
  );
}

function EnvironmentDialog({ projectId, environment, onClose, onSaved }: {
  projectId: string;
  environment: Environment | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(environment?.title ?? "");
  const [slug, setSlug] = useState(environment?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!environment);
  const [description, setDescription] = useState(environment?.description ?? "");
  const [type, setType] = useState<EnvType>(environment?.type ?? "DYNAMIC");
  const [host, setHost] = useState(environment?.host ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { title, slug, description: description || null, type, host };
      return environment
        ? (await api.patch(`/environments/${environment.id}`, body, { silent: true })).data
        : (await api.post("/environments", { projectId, ...body }, { silent: true })).data;
    },
    onSuccess: (env) => {
      logger.info(environment ? "environment updated" : "environment created", { environmentId: env.id, projectId });
      toast.success(t("common.saved"));
      onSaved();
    },
    onError: (e) => {
      logger.warn("environment save failed", { projectId, err: String(e) });
      setError(apiErrorMessage(e, t("common.something_went_wrong")));
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !slug.trim() || !host.trim()) return setError(t("environments.validation.required"));
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return setError(t("environments.validation.slug"));
    setError(null);
    save.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="env-dialog-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form noValidate onSubmit={onSubmit} className="w-full max-w-lg space-y-4 rounded-lg bg-white p-6 shadow-xl dark:border dark:border-slate-800 dark:bg-slate-900">
        <header className="flex items-start justify-between gap-3">
          <h2 id="env-dialog-title" className="text-xl font-semibold">{environment ? t("environments.edit") : t("environments.new")}</h2>
          <button type="button" className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" aria-label={t("common.close")} onClick={onClose}><X size={20} /></button>
        </header>
        <div>
          <label className="label" htmlFor="env-title">{t("environments.field_title")} <span className="text-red-500">*</span></label>
          <input id="env-title" className="input" autoFocus placeholder={t("environments.title_placeholder")} value={title}
            onChange={(e) => { setTitle(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} />
        </div>
        <div>
          <label className="label" htmlFor="env-slug">{t("environments.slug")} <span className="text-red-500">*</span></label>
          <input id="env-slug" className="input" placeholder="prod" value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} />
        </div>
        <div>
          <label className="label" htmlFor="env-desc">{t("common.description")}</label>
          <input id="env-desc" className="input" placeholder={t("environments.description_placeholder")} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <fieldset className="space-y-3">
          <legend className="label">{t("environments.type_label")}</legend>
          {(["DYNAMIC", "STATIC"] as const).map((k) => (
            <label key={k} className="flex cursor-pointer items-start gap-3">
              <input type="radio" name="env-type" className="mt-1" checked={type === k} onChange={() => setType(k)} />
              <span>
                <span className="block text-sm font-medium">{t(`environments.type_option.${k}`)}</span>
                <span className="block text-sm text-slate-500">{t(`environments.type_hint.${k}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div>
          <label className="label" htmlFor="env-host">{t(`environments.host_label.${type}`)} <span className="text-red-500">*</span></label>
          <input id="env-host" className="input" placeholder={t(`environments.host_placeholder.${type}`)} value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
        {error && <div role="alert" className="text-sm text-red-600">{error}</div>}
        <footer className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? t("common.please_wait") : t("common.save")}</Button>
        </footer>
      </form>
    </div>
  );
}
