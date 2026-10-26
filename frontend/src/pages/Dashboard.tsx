import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Bug,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  ListChecks,
  Play,
  Rocket,
  Target,
  TrendingUp,
} from "lucide-react";
import { api } from "../lib/api";
import { PageLoader } from "../components/Spinner";
import { priorityColors, runStatusColors } from "../lib/status";
import { logger } from "../lib/logger";

type TrendPoint = { day: string; total: number; passed: number; failed: number; passRate: number | null };

function TrendChart({ trend }: { trend: TrendPoint[] }) {
  const W = 600;
  const H = 110;
  const pad = { t: 8, r: 4, b: 18, l: 24 };
  const maxTotal = Math.max(1, ...trend.map((p) => p.total));
  const xStep = (W - pad.l - pad.r) / Math.max(1, trend.length - 1);
  const y = (v: number, max: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const execPath = trend.map((p, i) => `${i === 0 ? "M" : "L"} ${pad.l + i * xStep} ${y(p.total, maxTotal)}`).join(" ");
  const rateTrend = trend.filter((p) => p.passRate != null);
  const ratePath = rateTrend.length > 1
    ? rateTrend.map((p, i) => {
        const idx = trend.indexOf(p);
        return `${i === 0 ? "M" : "L"} ${pad.l + idx * xStep} ${y(p.passRate!, 100)}`;
      }).join(" ")
    : "";
  const firstDay = trend[0]?.day;
  const lastDay = trend[trend.length - 1]?.day;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#e2e8f0" />
      {execPath && <path d={execPath} fill="none" stroke="#8b5cf6" strokeWidth="1.5" />}
      {ratePath && <path d={ratePath} fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="3,3" />}
      <text x={pad.l} y={H - 4} fontSize="9" fill="#94a3b8">{firstDay}</text>
      <text x={W - pad.r} y={H - 4} fontSize="9" fill="#94a3b8" textAnchor="end">{lastDay}</text>
    </svg>
  );
}

type StatusKey = "PENDING" | "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED";

const statusMeta: Record<StatusKey, { bar: string; dot: string; text: string }> = {
  PASSED:  { bar: "bg-emerald-500", dot: "bg-emerald-500", text: "text-emerald-700" },
  FAILED:  { bar: "bg-red-500",     dot: "bg-red-500",     text: "text-red-700" },
  BLOCKED: { bar: "bg-amber-500",   dot: "bg-amber-500",   text: "text-amber-700" },
  SKIPPED: { bar: "bg-slate-400",   dot: "bg-slate-400",   text: "text-slate-600" },
  PENDING: { bar: "bg-slate-200 dark:bg-slate-700", dot: "bg-slate-300 dark:bg-slate-600", text: "text-slate-500 dark:text-slate-400" },
};

const statusOrder: StatusKey[] = ["PASSED", "FAILED", "BLOCKED", "SKIPPED", "PENDING"];

export function Dashboard() {
  const { t } = useTranslation();
  // The dashboard of the current project (Qase style); the API scopes every figure to it.
  const { id: projectId } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard", projectId],
    queryFn: async () => (await api.get("/dashboard", { params: { projectId } })).data,
  });

  if (error) logger.error("dashboard fetch failed", { projectId, error: String(error) });
  if (isLoading) return <PageLoader />;
  if (!data) return null;

  const passRate = data.passRate as number;
  const passTone =
    passRate >= 85 ? "emerald" : passRate >= 60 ? "amber" : "red";

  const stats = [
    { label: t("dashboard.cases"),    value: data.totals.cases,    icon: FileText,     tone: "slate" },
    { label: t("dashboard.runs"),     value: data.totals.runs,     icon: Play,         tone: "violet" },
    { label: t("dashboard.pass_rate"), value: `${passRate}%`,      icon: Target,       tone: passTone },
    { label: t("dashboard.my_open"),  value: data.totals.myOpen ?? 0,   icon: ListChecks, tone: "amber" },
    { label: t("dashboard.open_bugs"),value: data.totals.openBugs ?? 0, icon: Bug,        tone: "red" },
  ] as const;

  const toneClasses: Record<string, { border: string; bg: string; icon: string; text: string }> = {
    indigo:  { border: "border-l-indigo-500",  bg: "bg-indigo-50 dark:bg-indigo-500/10",   icon: "text-indigo-600 dark:text-indigo-300",   text: "text-indigo-900 dark:text-indigo-100" },
    slate:   { border: "border-l-slate-400",   bg: "bg-slate-50 dark:bg-slate-800/50",     icon: "text-slate-600 dark:text-slate-300",     text: "text-slate-900 dark:text-slate-100" },
    violet:  { border: "border-l-violet-500",  bg: "bg-violet-50 dark:bg-violet-500/10",   icon: "text-violet-600 dark:text-violet-300",   text: "text-violet-900 dark:text-violet-100" },
    emerald: { border: "border-l-emerald-500", bg: "bg-emerald-50 dark:bg-emerald-500/10", icon: "text-emerald-600 dark:text-emerald-300", text: "text-emerald-900 dark:text-emerald-100" },
    amber:   { border: "border-l-amber-500",   bg: "bg-amber-50 dark:bg-amber-500/10",     icon: "text-amber-600 dark:text-amber-300",     text: "text-amber-900 dark:text-amber-100" },
    red:     { border: "border-l-red-500",     bg: "bg-red-50 dark:bg-red-500/10",         icon: "text-red-600 dark:text-red-300",         text: "text-red-900 dark:text-red-100" },
  };

  const totalExec = data.totals.executions as number;
  const sc = data.statusCounts as Record<StatusKey, number>;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
        <p className="text-sm text-slate-500">{t("dashboard.subtitle")}</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {stats.map((s) => {
          const c = toneClasses[s.tone];
          const Icon = s.icon;
          return (
            <div key={s.label} className={`card p-5 border-l-4 ${c.border} ${c.bg}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs font-semibold uppercase text-slate-600">{s.label}</div>
                <Icon size={18} className={c.icon} />
              </div>
              <div className={`text-3xl font-bold mt-2 ${c.text}`}>{s.value}</div>
            </div>
          );
        })}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">{t("dashboard.execution_status")}</h2>
          <span className="text-xs text-slate-500">{t("dashboard.total_count", { count: totalExec })}</span>
        </div>
        {totalExec === 0 ? (
          <div className="text-sm text-slate-500">—</div>
        ) : (
          <>
            <div className="flex h-3 w-full rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800">
              {statusOrder.map((s) => {
                const count = sc[s] ?? 0;
                if (!count) return null;
                const pct = (count / totalExec) * 100;
                return (
                  <div
                    key={s}
                    className={statusMeta[s].bar}
                    style={{ width: `${pct}%` }}
                    title={`${t(`status.${s}`)}: ${count}`}
                  />
                );
              })}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
              {statusOrder.map((s) => {
                const count = sc[s] ?? 0;
                const pct = totalExec > 0 ? Math.round((count / totalExec) * 100) : 0;
                return (
                  <div key={s} className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${statusMeta[s].dot}`} />
                    <div className="min-w-0">
                      <div className={`text-xs uppercase font-semibold ${statusMeta[s].text}`}>{t(`status.${s}`)}</div>
                      <div className="text-sm font-medium">
                        {count} <span className="text-slate-400 text-xs">· {pct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {Array.isArray(data.trend) && data.trend.some((d: any) => d.total > 0) && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <TrendingUp size={16} className="text-violet-600" />
              {t("dashboard.trend_30d")}
            </h2>
            <div className="text-xs text-slate-500 flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-500" /> {t("dashboard.executions_label")}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {t("dashboard.pass_rate_label")}</span>
            </div>
          </div>
          <TrendChart trend={data.trend} />
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Rocket size={16} className="text-indigo-600" />
            {t("dashboard.release_readiness")}
          </h2>
          {(data.releaseReadiness ?? []).length === 0 ? (
            <div className="text-sm text-slate-500">{t("dashboard.no_upcoming_milestones")}</div>
          ) : (
            <ul className="space-y-3">
              {data.releaseReadiness.map((m: any) => {
                const ready = m.executedPct >= 90 && m.passRateOfExecuted >= 90 && m.blockerOpen === 0;
                const tone = ready ? "emerald" : m.blockerOpen > 0 ? "red" : "amber";
                return (
                  <li key={m.id}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="font-medium truncate">{m.name}</div>
                      <span className={`badge ${tone === "emerald" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : tone === "red" ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"}`}>
                        {ready ? t("dashboard.readiness_READY") : m.blockerOpen > 0 ? `${m.blockerOpen} ${t("dashboard.readiness_BLOCKERS")}` : t("dashboard.readiness_IN_PROGRESS")}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
                      {m.total > 0 && <div className="bg-emerald-500" style={{ width: `${(m.passed / m.total) * 100}%` }} />}
                      {m.total > 0 && <div className="bg-red-500" style={{ width: `${(m.failed / m.total) * 100}%` }} />}
                      {m.total > 0 && <div className="bg-amber-500" style={{ width: `${(m.blocked / m.total) * 100}%` }} />}
                    </div>
                    <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                      <span>{m.project.name}</span>
                      <span>{t("dashboard.executed_pct", { pct: m.executedPct })}</span>
                      <span>{t("dashboard.pass_pct", { pct: m.passRateOfExecuted })}</span>
                      {m.dueDate && <span>{t("dashboard.due", { date: new Date(m.dueDate).toLocaleDateString() })}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Clock size={16} className="text-red-600" />
            {t("dashboard.defect_aging")}
          </h2>
          {(data.defectAging?.totalFailed ?? 0) === 0 ? (
            <div className="text-sm text-slate-500">{t("dashboard.no_failing_cases")}</div>
          ) : (
            <div className="space-y-2">
              {(["0-7d", "8-30d", "31-90d", "90d+"] as const).map((bucket) => {
                const count = data.defectAging.buckets[bucket] ?? 0;
                const pct = data.defectAging.totalFailed > 0 ? Math.round((count / data.defectAging.totalFailed) * 100) : 0;
                const tone =
                  bucket === "0-7d" ? "bg-emerald-500" :
                  bucket === "8-30d" ? "bg-amber-500" :
                  bucket === "31-90d" ? "bg-orange-500" : "bg-red-600";
                return (
                  <div key={bucket} className="flex items-center gap-3">
                    <div className="text-xs font-semibold uppercase text-slate-600 w-16">{bucket}</div>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-sm font-medium w-16 text-right">
                      {count} <span className="text-xs text-slate-400">· {pct}%</span>
                    </div>
                  </div>
                );
              })}
              <div className="text-xs text-slate-500 pt-2">
                {t("dashboard.total_failing", { count: data.defectAging.totalFailed })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <ListChecks size={16} className="text-amber-600" />
            {t("dashboard.my_assignments")}
          </h2>
          {(data.myAssignments ?? []).length === 0 ? (
            <div className="text-sm text-slate-500">{t("dashboard.no_assignments")}</div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.myAssignments.map((e: any) => (
                <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link to={`/runs/${e.run.id}`} className="font-medium hover:underline truncate block">
                      {e.case.title}
                    </Link>
                    <div className="text-xs text-slate-500 truncate">
                      {e.run.project.name} · {e.run.name}
                      {e.run.dueDate && <> · {t("dashboard.due", { date: new Date(e.run.dueDate).toLocaleDateString() })}</>}
                    </div>
                  </div>
                  <span className={`badge ${priorityColors[e.case.priority]}`}>{e.case.priority}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Play size={16} className="text-violet-600" />
            {t("dashboard.active_runs")}
          </h2>
          {(data.activeRuns ?? []).length === 0 ? (
            <div className="text-sm text-slate-500">{t("dashboard.no_active_runs")}</div>
          ) : (
            <ul className="space-y-3">
              {data.activeRuns.map((r: any) => (
                <li key={r.id}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <Link to={`/runs/${r.id}`} className="font-medium hover:underline truncate">
                      {r.name}
                    </Link>
                    <span className="text-xs text-slate-500 shrink-0">{r.done}/{r.total}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-violet-500" style={{ width: `${r.progress}%` }} />
                  </div>
                  <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                    <span>{r.project.name}</span>
                    {r.passed > 0 && <span className="text-emerald-600 inline-flex items-center gap-0.5"><CheckCircle2 size={12} /> {r.passed}</span>}
                    {r.failed > 0 && <span className="text-red-600">✗ {r.failed}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-4">{t("dashboard.recent_runs")}</h2>
          {data.recentRuns.length === 0 ? (
            <div className="text-sm text-slate-500">{t("dashboard.no_runs")}</div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.recentRuns.map((r: any) => (
                <li key={r.id} className="py-2 flex items-center justify-between">
                  <div>
                    <Link to={`/runs/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.project.name} · {r._count.executions}</div>
                  </div>
                  <span className={`badge ${runStatusColors[r.status]}`}>{r.status.replace("_", " ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <CalendarClock size={16} className="text-indigo-600" />
            {t("dashboard.upcoming_milestones")}
          </h2>
          {(data.upcomingMilestones ?? []).length === 0 ? (
            <div className="text-sm text-slate-500">{t("dashboard.no_upcoming_milestones")}</div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.upcomingMilestones.map((m: any) => (
                <li key={m.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{m.name}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {m.project.name} · {t("milestones.runs_count", { count: m._count.runs })}
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0">
                    {m.dueDate && new Date(m.dueDate).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5 md:col-span-2">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-600" />
            {t("dashboard.top_failing_cases")}
          </h2>
          {(data.topFailingCases ?? []).length === 0 ? (
            <div className="text-sm text-slate-500">{t("dashboard.no_failing_cases")}</div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.topFailingCases.map((c: any) => (
                <li key={c.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link to={`/cases/${c.id}`} className="font-medium hover:underline truncate block">
                      {c.title}
                    </Link>
                    <div className="text-xs text-slate-500 truncate">
                      {c.suite.project.name} · {c.suite.name}
                    </div>
                  </div>
                  <span className="badge bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300 flex items-center gap-1 shrink-0">
                    <Bug size={12} /> {c.failures}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
