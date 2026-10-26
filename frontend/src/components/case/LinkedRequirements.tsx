import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ExternalLink, Link2, Plus, X } from "lucide-react";
import { api } from "../../lib/api";
import { logger } from "../../lib/logger";

type LinkedReq = { id: string; externalRef: string; title: string };

/** Requirements linked to a case; while editing, link or unlink them. */
export function LinkedRequirements({
  caseId,
  projectId,
  editing,
  linked,
}: {
  caseId: string;
  projectId: string;
  editing: boolean;
  linked: LinkedReq[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [pickId, setPickId] = useState("");

  const { data: allReqs = [] } = useQuery<LinkedReq[]>({
    queryKey: ["requirements", projectId],
    queryFn: async () => (await api.get(`/requirements`, { params: { projectId } })).data,
    enabled: !!projectId && editing,
  });

  const link = useMutation({
    mutationFn: async (reqId: string) => api.post(`/requirements/${reqId}/cases`, { caseId }),
    onSuccess: (_data, requirementId) => {
      logger.info("requirement linked to case", { caseId, requirementId });
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["requirements", projectId] });
      setPickId("");
      toast.success(t("requirement.linked"));
    },
  });

  const unlink = useMutation({
    mutationFn: async (reqId: string) => api.delete(`/requirements/${reqId}/cases/${caseId}`),
    onSuccess: (_data, requirementId) => {
      logger.info("requirement unlinked from case", { caseId, requirementId });
      qc.invalidateQueries({ queryKey: ["case", caseId] });
      qc.invalidateQueries({ queryKey: ["requirements", projectId] });
      toast.success(t("requirement.unlinked"));
    },
  });

  const linkedIds = new Set(linked.map((r) => r.id));
  const pickable = allReqs.filter((r) => !linkedIds.has(r.id));

  if (!editing && linked.length === 0) return null;

  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Link2 size={16} /> {t("requirements.linked_cases")}
        </h2>
        <Link to={`/projects/${projectId}/requirements`} className="text-xs text-brand-600 hover:underline">
          {t("requirements.title")}
        </Link>
      </div>
      {linked.length === 0 ? (
        <div className="text-sm text-slate-500">{t("requirements.empty")}</div>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {linked.map((r) => (
            <li key={r.id} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
              {/^https?:\/\//.test(r.externalRef) ? (
                <a href={r.externalRef} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1 font-mono">
                  {r.externalRef} <ExternalLink size={10} />
                </a>
              ) : (
                <span className="font-mono">{r.externalRef}</span>
              )}
              <span className="text-slate-700">· {r.title}</span>
              {editing && (
                <button
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => unlink.mutate(r.id)}
                  aria-label={t("common.unlink")}
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && pickable.length > 0 && (
        <div className="flex items-center gap-2">
          <select className="input flex-1" value={pickId} onChange={(e) => setPickId(e.target.value)}>
            <option value="">{t("requirements.pick_for_case")}</option>
            {pickable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.externalRef} — {r.title}
              </option>
            ))}
          </select>
          <button
            className="btn-secondary"
            disabled={!pickId || link.isPending}
            onClick={() => pickId && link.mutate(pickId)}
          >
            <Plus size={14} /> {t("common.create")}
          </button>
        </div>
      )}
    </section>
  );
}
