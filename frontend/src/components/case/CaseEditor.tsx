import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BookOpen, GripVertical, Plus, Trash2, X } from "lucide-react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../lib/api";
import { logger } from "../../lib/logger";
import { apiErrorMessage } from "../../lib/apiError";
import type { Parameter, Step, Substep } from "../../lib/caseModel";
import { RichEditor } from "../RichEditor";
import { Button } from "../ui/Button";

type SharedStep = { id: string; name: string; action: string; expected: string };

export type EditableCase = {
  id: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  postconditions: string | null;
  parameters: Parameter[];
  steps: Step[];
};

type Props = { testCase: EditableCase; projectId: string; onCancel: () => void; onSaved: () => void };

/**
 * Edits the "General" part of a case, Qase style: title, description, pre- and
 * post-conditions, parameter groups and steps with substeps and input data.
 * Properties (priority, suite, tags, …) are edited on their own tab.
 */
export function CaseEditor({ testCase, projectId, onCancel, onSaved }: Props) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(testCase.title);
  const [description, setDescription] = useState(testCase.description ?? "");
  const [preconditions, setPreconditions] = useState(testCase.preconditions ?? "");
  const [postconditions, setPostconditions] = useState(testCase.postconditions ?? "");
  const [parameters, setParameters] = useState<Parameter[]>(() => testCase.parameters.map((p) => ({ ...p, values: [...p.values] })));
  const [steps, setSteps] = useState<Step[]>(() => testCase.steps.map((s) => ({ ...s, substeps: s.substeps?.map((x) => ({ ...x })) })));
  const idCounter = useRef(0);
  const nextId = () => `s-${++idCounter.current}`;
  const [stepIds, setStepIds] = useState<string[]>(() => testCase.steps.map(() => nextId()));
  const [libraryOpen, setLibraryOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const { data: sharedSteps = [] } = useQuery<SharedStep[]>({
    queryKey: ["shared-steps", projectId],
    queryFn: async () => (await api.get("/shared-steps", { params: { projectId } })).data,
    enabled: libraryOpen,
  });

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/cases/${testCase.id}`, {
        title,
        description: description || null,
        preconditions: preconditions || null,
        postconditions: postconditions || null,
        parameters: parameters.map((p) => ({ title: p.title.trim(), values: p.values })),
        steps: steps.map((s) => ({
          ...s,
          data: s.data || undefined,
          substeps: s.substeps?.length
            ? s.substeps.map((x) => ({ action: x.action, expected: x.expected || undefined, data: x.data || undefined }))
            : undefined,
        })),
      }, { silent: true })).data,
    onSuccess: () => {
      logger.info("case saved", { caseId: testCase.id, steps: steps.length, parameters: parameters.length });
      toast.success(t("cases.saved"));
      onSaved();
    },
    onError: (e) => {
      const msg = apiErrorMessage(e, t("common.something_went_wrong"));
      toast.error(msg);
      logger.error("case save failed", { caseId: testCase.id, msg });
    },
  });

  function validate(): string | null {
    if (!title.trim()) return t("cases.validation.title_required");
    if (parameters.some((p) => !p.title.trim())) return t("cases.validation.parameter_name_empty");
    for (let i = 0; i < steps.length; i += 1) {
      const s = steps[i];
      if (!s.action?.trim()) return t("cases.validation.step_action_empty", { step: i + 1 });
      if (!s.expected?.trim()) return t("cases.validation.step_expected_empty", { step: i + 1 });
      const bad = (s.substeps ?? []).findIndex((x) => !x.action?.trim());
      if (bad !== -1) return t("cases.validation.substep_action_empty", { step: `${i + 1}.${bad + 1}` });
    }
    return null;
  }

  function onSave() {
    const err = validate();
    if (err) return toast.error(err);
    save.mutate();
  }

  const updateStep = (i: number, patch: Partial<Step>) => setSteps((xs) => xs.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const updateSub = (i: number, k: number, patch: Partial<Substep>) =>
    updateStep(i, { substeps: (steps[i].substeps ?? []).map((x, j) => (j === k ? { ...x, ...patch } : x)) });
  const addStep = (s: Step) => {
    setSteps((xs) => [...xs, s]);
    setStepIds((ids) => [...ids, nextId()]);
  };
  const removeStep = (i: number) => {
    setSteps((xs) => xs.filter((_, j) => j !== i));
    setStepIds((ids) => ids.filter((_, j) => j !== i));
  };
  function onDragEnd(e: DragEndEvent) {
    const from = stepIds.indexOf(String(e.active.id));
    const to = e.over ? stepIds.indexOf(String(e.over.id)) : -1;
    if (from === -1 || to === -1 || from === to) return;
    setStepIds((ids) => arrayMove(ids, from, to));
    setSteps((xs) => arrayMove(xs, from, to));
  }

  const rows = Math.max(0, ...parameters.map((p) => p.values.length));
  const setParam = (pi: number, patch: Partial<Parameter>) => setParameters((ps) => ps.map((p, j) => (j === pi ? { ...p, ...patch } : p)));
  const setCell = (pi: number, r: number, v: string) => {
    const values = Array.from({ length: rows }, (_, k) => parameters[pi].values[k] ?? "");
    values[r] = v;
    setParam(pi, { values });
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="label">{t("cases.title")}</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <label className="label">{t("common.description")}</label>
        <RichEditor value={description} onChange={setDescription} minHeight={64} />
      </div>
      <div>
        <label className="label">{t("cases.preconditions")}</label>
        <RichEditor value={preconditions} onChange={setPreconditions} minHeight={64} />
      </div>
      <div>
        <label className="label">{t("cases.postconditions")}</label>
        <RichEditor value={postconditions} onChange={setPostconditions} minHeight={48} />
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="label mb-0">{t("cases.parameters")}</label>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setParameters((ps) => [...ps, { title: "", values: Array(rows).fill("") }])}>
              <Plus size={14} /> {t("cases.add_parameter")}
            </button>
            {parameters.length > 0 && (
              <button type="button" className="btn-secondary" onClick={() => setParameters((ps) => ps.map((p) => ({ ...p, values: [...Array.from({ length: rows }, (_, k) => p.values[k] ?? ""), ""] })))}>
                <Plus size={14} /> {t("cases.add_parameter_row")}
              </button>
            )}
          </div>
        </div>
        {parameters.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60">
                <tr>
                  {parameters.map((p, pi) => (
                    <th key={pi} className="p-1.5">
                      <div className="flex items-center gap-1">
                        <input className="input font-semibold" placeholder={t("cases.parameter_name")} value={p.title} onChange={(e) => setParam(pi, { title: e.target.value })} />
                        <button type="button" className="text-slate-400 hover:text-red-600" aria-label={t("common.delete")} onClick={() => setParameters((ps) => ps.filter((_, j) => j !== pi))}>
                          <X size={14} />
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_, r) => (
                  <tr key={r} className="border-t border-slate-200 dark:border-slate-700">
                    {parameters.map((p, pi) => (
                      <td key={pi} className="p-1.5">
                        <input className="input" value={p.values[r] ?? ""} onChange={(e) => setCell(pi, r, e.target.value)} />
                      </td>
                    ))}
                    <td className="p-1.5 text-center">
                      <button type="button" className="text-slate-400 hover:text-red-600" aria-label={t("common.delete")}
                        onClick={() => setParameters((ps) => ps.map((x) => ({ ...x, values: x.values.filter((_, k) => k !== r) })))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="label mb-0">{t("cases.steps")}</label>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setLibraryOpen(true)}>
              <BookOpen size={14} /> {t("cases.shared_library")}
            </button>
            <button type="button" className="btn-secondary" onClick={() => addStep({ action: "", expected: "" })}>
              <Plus size={14} /> {t("cases.step")}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-500">{t("cases.markdown_hint")}</p>
        {steps.length === 0 ? (
          <p className="text-sm text-slate-500">{t("cases.no_steps")}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
              <ol className="space-y-3">
                {steps.map((s, i) => (
                  <SortableStep key={stepIds[i]} id={stepIds[i]} index={i} step={s}
                    onChange={(patch) => updateStep(i, patch)}
                    onChangeSub={(k, patch) => updateSub(i, k, patch)}
                    onAddSub={() => updateStep(i, { substeps: [...(s.substeps ?? []), { action: "", expected: "" }] })}
                    onRemoveSub={(k) => updateStep(i, { substeps: (s.substeps ?? []).filter((_, j) => j !== k) })}
                    onRemove={() => removeStep(i)} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white py-3 dark:border-slate-800 dark:bg-slate-900">
        <Button variant="secondary" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={onSave} disabled={save.isPending}>
          {save.isPending ? t("common.please_wait") : t("common.save")}
        </Button>
      </div>

      {libraryOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setLibraryOpen(false)}>
          <div className="max-h-[80vh] w-full max-w-xl overflow-auto rounded-lg bg-white shadow-xl dark:border dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
              <h3 className="font-semibold">{t("cases.shared_library")}</h3>
              <button type="button" className="text-slate-400 hover:text-slate-700" aria-label={t("common.close")} onClick={() => setLibraryOpen(false)}><X size={18} /></button>
            </div>
            <div className="space-y-2 p-4">
              {sharedSteps.length === 0 && <div className="text-sm text-slate-500">{t("cases.no_shared_steps")}</div>}
              {sharedSteps.map((s) => (
                <button key={s.id} type="button" className="w-full rounded-md border border-slate-200 p-3 text-left hover:border-brand-400 dark:border-slate-700"
                  onClick={() => {
                    addStep({ action: s.action, expected: s.expected, sharedStepId: s.id });
                    setLibraryOpen(false);
                    logger.info("shared step inserted", { sharedStepId: s.id, caseId: testCase.id });
                  }}>
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="mt-1 line-clamp-2 text-xs text-slate-500">{s.action}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableStep({ id, index, step, onChange, onChangeSub, onAddSub, onRemoveSub, onRemove }: {
  id: string;
  index: number;
  step: Step;
  onChange: (patch: Partial<Step>) => void;
  onChangeSub: (k: number, patch: Partial<Substep>) => void;
  onAddSub: () => void;
  onRemoveSub: (k: number) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`rounded-md border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 ${isDragging ? "shadow-lg" : ""}`}>
      <div className="flex items-start gap-2">
        <button type="button" aria-label={t("cases.reorder_step", { step: index + 1 })} className="mt-1 cursor-grab touch-none text-slate-400 hover:text-slate-600" {...attributes} {...listeners}>
          <GripVertical size={16} />
        </button>
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">{index + 1}</div>
        <div className="min-w-0 flex-1 space-y-2">
          <RichEditor value={step.action} onChange={(v) => onChange({ action: v })} placeholder={t("cases.action")} minHeight={48} />
          <input className="input" value={step.data ?? ""} onChange={(e) => onChange({ data: e.target.value })} placeholder={t("cases.input_data")} />
          <RichEditor value={step.expected} onChange={(v) => onChange({ expected: v })} placeholder={t("cases.expected_result")} minHeight={48} />
          {(step.substeps ?? []).map((sub, k) => (
            <div key={k} className="ml-4 space-y-1.5 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">{index + 1}.{k + 1}</span>
                <input className="input" value={sub.action} onChange={(e) => onChangeSub(k, { action: e.target.value })} placeholder={t("cases.action")} />
                <button type="button" className="text-slate-400 hover:text-red-600" aria-label={t("common.delete")} onClick={() => onRemoveSub(k)}><Trash2 size={14} /></button>
              </div>
              <input className="input" value={sub.data ?? ""} onChange={(e) => onChangeSub(k, { data: e.target.value })} placeholder={t("cases.input_data")} />
              <input className="input" value={sub.expected ?? ""} onChange={(e) => onChangeSub(k, { expected: e.target.value })} placeholder={t("cases.expected_result")} />
            </div>
          ))}
          <button type="button" className="ml-4 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline dark:text-brand-300" onClick={onAddSub}>
            <Plus size={12} /> {t("cases.add_substep")}
          </button>
        </div>
        <button type="button" className="mt-1 text-slate-400 hover:text-red-600" aria-label={t("common.delete")} onClick={onRemove}><Trash2 size={16} /></button>
      </div>
    </li>
  );
}
