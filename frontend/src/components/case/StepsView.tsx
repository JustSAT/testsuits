import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Link2 } from "lucide-react";
import { Markdown } from "../../lib/markdown";
import { parameterRows, type Parameter, type Step } from "../../lib/caseModel";
import { Badge } from "../ui/Badge";

/** Parameter groups as a table: one column per parameter, one row per combination. */
export function ParameterTable({ parameters }: { parameters: Parameter[] }) {
  const rows = parameterRows(parameters);
  if (parameters.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left dark:bg-slate-800/60">
          <tr>{parameters.map((p, i) => <th key={i} className="px-3 py-2 font-semibold">{p.title}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-slate-200 align-top dark:border-slate-700">
              {row.map((v, c) => <td key={c} className="px-3 py-2">{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Steps with their expected results, input data and collapsible substeps (Qase style). */
export function StepsView({ steps }: { steps: Step[] }) {
  const { t } = useTranslation();
  if (steps.length === 0) return <p className="text-sm text-slate-500">{t("cases.no_steps")}</p>;
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => <StepItem key={i} step={s} number={i + 1} />)}
    </ol>
  );
}

function StepItem({ step, number }: { step: Step; number: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const subs = step.substeps ?? [];
  return (
    <li className="flex items-start gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
        {number}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-2">
          <Markdown source={step.action} className="text-sm" />
          {step.sharedStepId && (
            <Badge tone="violet" size="xs" title={t("cases.linked_shared_step")}><Link2 size={10} /> {t("cases.shared")}</Badge>
          )}
        </div>
        {step.data && (
          <div>
            <div className="text-xs font-semibold text-slate-500">{t("cases.input_data")}</div>
            <Markdown source={step.data} className="text-sm" />
          </div>
        )}
        {step.expected && step.expected !== "—" && (
          <div>
            <div className="text-xs font-semibold text-slate-500">{t("cases.expected_result")}</div>
            <Markdown source={step.expected} className="text-sm" />
          </div>
        )}
        {subs.length > 0 && (
          <div>
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-slate-500">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t("cases.substeps")} ({subs.length})
            </button>
            {open && (
              <ol className="mt-2 space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
                {subs.map((sub, j) => (
                  <li key={j} className="space-y-1">
                    <div className="flex items-start gap-2">
                      <span className="text-xs font-semibold text-slate-500">{number}.{j + 1}</span>
                      <Markdown source={sub.action} className="text-sm" />
                    </div>
                    {sub.data && <div className="pl-6 text-sm"><span className="text-xs font-semibold text-slate-500">{t("cases.input_data")}:</span> {sub.data}</div>}
                    {sub.expected && (
                      <div className="pl-6">
                        <div className="text-xs font-semibold text-slate-500">{t("cases.expected_result")}</div>
                        <Markdown source={sub.expected} className="text-sm" />
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
