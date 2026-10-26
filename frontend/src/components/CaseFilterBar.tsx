import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { TEST_LEVELS } from "../lib/enums";
import { CASE_FILTER_FIELDS, type CaseFilterField, type CaseFilters } from "../lib/caseTree";
import { MultiSelect } from "./ui/MultiSelect";
import { PriorityIcon } from "./PriorityIcon";

type Props = {
  query: string;
  onQuery: (q: string) => void;
  fields: CaseFilterField[];
  onFields: (fields: CaseFilterField[]) => void;
  filters: CaseFilters;
  onFilters: (filters: CaseFilters) => void;
  /** Every tag in use, for the Tags filter. */
  tags: string[];
  autoFocus?: boolean;
};

/** Case search plus Qase-style "Add filter" (priority, test level, tags). */
export function CaseFilterBar({ query, onQuery, fields, onFields, filters, onFilters, tags, autoFocus }: Props) {
  const { t } = useTranslation();

  const fieldLabel = (f: CaseFilterField) =>
    f === "priority" ? t("suites.priority") : f === "testLevel" ? t("test_level.label") : t("runs.picker.tags");
  const valueOptions = (f: CaseFilterField) =>
    f === "priority"
      ? ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => ({
          value: p,
          label: <><PriorityIcon priority={p} /> {t(`priority.${p}`)}</>,
          searchText: t(`priority.${p}`),
        }))
      : f === "testLevel"
        ? TEST_LEVELS.map((l) => ({ value: l, label: t(`test_level.${l}`) }))
        : tags.map((tag) => ({ value: tag, label: tag }));
  const setFields = (picked: string[]) => {
    const next = CASE_FILTER_FIELDS.filter((f) => picked.includes(f));
    onFields(next);
    onFilters(Object.fromEntries(next.map((f) => [f, filters[f] ?? []])) as CaseFilters);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full max-w-md">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-8"
          placeholder={t("runs.picker.search_placeholder")}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          autoFocus={autoFocus}
        />
      </div>
      {fields.map((f) => (
        <MultiSelect
          key={f}
          variant="chip"
          prefix={fieldLabel(f)}
          placeholder={fieldLabel(f)}
          options={valueOptions(f)}
          value={filters[f] ?? []}
          onChange={(v) => onFilters({ ...filters, [f]: v })}
          aria-label={fieldLabel(f)}
        />
      ))}
      <MultiSelect
        variant="link"
        triggerLabel={t("runs.picker.add_filter")}
        placeholder={t("runs.picker.add_filter")}
        searchable
        options={CASE_FILTER_FIELDS.map((f) => ({ value: f, label: fieldLabel(f), searchText: fieldLabel(f) }))}
        value={fields}
        onChange={setFields}
      />
    </div>
  );
}
