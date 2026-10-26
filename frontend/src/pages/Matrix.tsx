import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { execStatusColors } from "../lib/status";
import { testLevelColors } from "../lib/enums";
import { logger } from "../lib/logger";

type Dimension = "platform" | "connectivity" | "locale" | "requirement";
const DIMENSIONS: Dimension[] = ["platform", "connectivity", "locale", "requirement"];

export function Matrix() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { id: projectId = "" } = useParams();
  const [dimension, setDimension] = useState<Dimension>((params.get("dimension") as Dimension) ?? "platform");

  const { data: matrix, error } = useQuery({
    queryKey: ["matrix", projectId, dimension],
    queryFn: async () => (await api.get(`/matrix/projects/${projectId}`, { params: { dimension } })).data,
    enabled: !!projectId,
  });

  useMemo(() => {
    if (error) logger.error("matrix fetch failed", { projectId, dimension, error: String(error) });
  }, [error, projectId, dimension]);

  function selectDimension(d: Dimension) {
    setDimension(d);
    const next = new URLSearchParams(params);
    next.set("dimension", d);
    setParams(next);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t("matrix.title")}</h1>
        <p className="text-sm text-slate-500">{t("matrix.subtitle")}</p>
      </header>

      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="label">{t("matrix.dimension")}</label>
          <div className="flex gap-1">
            {DIMENSIONS.map((d) => (
              <button
                key={d}
                onClick={() => selectDimension(d)}
                className={`btn ${dimension === d ? "bg-brand-600 text-white dark:bg-brand-500" : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"}`}
              >
                {t(`${d}.label`)}
              </button>
            ))}
          </div>
        </div>
      </div>


      {projectId && matrix && matrix.buckets.length === 0 && (
        <div className="card p-10 text-center text-slate-500">{t("matrix.no_data")}</div>
      )}

      {projectId && matrix && matrix.buckets.length > 0 && (
        <div className="card overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="text-left px-4 py-2 font-semibold sticky left-0 bg-slate-50 dark:bg-slate-800/50 z-10">{t("cases.title")}</th>
                <th className="text-left px-2 py-2 font-semibold">{t("test_level.label")}</th>
                {matrix.buckets.map((b: string) => (
                  <th key={b} className="text-center px-3 py-2 font-semibold whitespace-nowrap">{b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row: any) => (
                <tr key={row.caseId} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 group">
                  <td className="px-4 py-2 sticky left-0 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/60 z-10">
                    <Link to={`/cases/${row.caseId}`} className="font-medium hover:underline">{row.title}</Link>
                    <div className="text-xs text-slate-500">{row.suite.name}</div>
                  </td>
                  <td className="px-2 py-2">
                    <span className={`badge ${testLevelColors[row.testLevel as keyof typeof testLevelColors] ?? ""}`}>
                      {t(`test_level.${row.testLevel}`)}
                    </span>
                  </td>
                  {row.cells.map((cell: any, i: number) => (
                    <td key={i} className="px-3 py-2 text-center">
                      {cell ? (
                        cell.runId ? (
                          <Link to={`/runs/${cell.runId}`} title={cell.runName}>
                            <span className={`badge ${execStatusColors[cell.status as keyof typeof execStatusColors] ?? "bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400"}`}>{cell.status}</span>
                          </Link>
                        ) : (
                          <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400" title={t("matrix.linked_not_executed")}>{cell.status}</span>
                        )
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
