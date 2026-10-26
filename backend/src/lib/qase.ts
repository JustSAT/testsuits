/**
 * Qase JSON import/export. Pure: converts a Qase repository export (the file
 * Qase's "Export → JSON" produces, suites nested with their cases) into a plan
 * of suites and cases in TestSuits terms, and builds the same shape back from
 * TestSuits data. Persistence lives in lib/qaseImport.ts.
 *
 * Mapping, kept identical to how earlier DM data was converted:
 * - priority → priority (Qase has no "critical": CRITICAL exports as "high");
 * - severity, type, behavior, layer and each Platform value → tags
 *   "severity:major", "type:functional", … ("Not set" values and the default
 *   type "other" are skipped);
 * - params → parameters, steps → steps with substeps and input data;
 * - a step with no expected result gets "—" (TestSuits requires one), which
 *   exports back as empty.
 */

export class QaseFormatError extends Error {
  constructor() {
    super("IMPORT_QASE_INVALID");
  }
}

export const NO_SUITE_REF = "none";
const NO_EXPECTED = "—";
const ATTRIBUTE_TAGS = ["severity", "type", "behavior", "layer"] as const;
const UNSET = new Set(["", "undefined", "unknown", "not set", "not-set"]);

export type Substep = { action: string; expected?: string; data?: string };
export type Step = { action: string; expected: string; data?: string; substeps?: Substep[] };
export type Parameter = { title: string; values: string[] };
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PlannedSuite = { externalRef: string; parentRef: string | null; name: string; description: string | null };
export type PlannedCase = {
  externalRef: string;
  suiteRef: string;
  title: string;
  description: string | null;
  preconditions: string | null;
  postconditions: string | null;
  priority: Priority;
  tags: string[];
  parameters: Parameter[];
  steps: Step[];
};
export type QasePlan = { suites: PlannedSuite[]; cases: PlannedCase[] };

type RawStep = { action?: unknown; expected_result?: unknown; data?: unknown; steps?: unknown };
type RawCase = Record<string, unknown>;
type RawSuite = { id?: unknown; title?: unknown; description?: unknown; suites?: unknown; cases?: unknown };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const idOf = (v: unknown): string => {
  if (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) return String(v);
  throw new QaseFormatError();
};

/** Qase text: Markdown with the odd <br/> and <span>; TestSuits stores Markdown. */
function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?span[^>]*>/gi, "").replace(/\r\n/g, "\n").trim();
  return s === "" ? null : s;
}

function priorityOf(v: unknown): Priority {
  switch (String(v ?? "").toLowerCase()) {
    case "high": return "HIGH";
    case "low": return "LOW";
    default: return "MEDIUM";
  }
}

function tagsOf(c: RawCase): string[] {
  const tags = asArray(c.tags).filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim());
  for (const field of ATTRIBUTE_TAGS) {
    const v = String(c[field] ?? "").trim().toLowerCase();
    // "other" is Qase's default type, as unset as "undefined" is elsewhere.
    if (!UNSET.has(v) && !(field === "type" && v === "other")) tags.push(`${field}:${v}`);
  }
  for (const cf of asArray(c.custom_fields)) {
    if (!isObject(cf) || String(cf.title ?? "").trim().toLowerCase() !== "platform") continue;
    for (const v of asArray(cf.value).length ? asArray(cf.value) : [cf.value]) {
      const value = String(v ?? "").trim().toLowerCase();
      if (!UNSET.has(value) && value !== "null") tags.push(`platform:${value}`);
    }
  }
  return Array.from(new Set(tags));
}

function stepsOf(raw: unknown): Step[] {
  return asArray(raw).filter(isObject).map((s: RawStep) => {
    const step: Step = { action: text(s.action) ?? NO_EXPECTED, expected: text(s.expected_result) ?? NO_EXPECTED };
    const data = text(s.data);
    if (data) step.data = data;
    const substeps = asArray(s.steps).filter(isObject).map((x: RawStep) => {
      const sub: Substep = { action: text(x.action) ?? NO_EXPECTED };
      const expected = text(x.expected_result);
      const subData = text(x.data);
      if (expected) sub.expected = expected;
      if (subData) sub.data = subData;
      return sub;
    });
    if (substeps.length) step.substeps = substeps;
    return step;
  });
}

function parametersOf(raw: unknown): Parameter[] {
  return asArray(raw)
    .filter(isObject)
    .map((p) => ({ title: String(p.title ?? "").trim(), values: asArray(p.values).map((v) => String(v ?? "")) }))
    .filter((p) => p.title !== "");
}

function caseOf(c: unknown, suiteRef: string): PlannedCase {
  if (!isObject(c)) throw new QaseFormatError();
  const title = text(c.title);
  if (!title) throw new QaseFormatError();
  return {
    externalRef: idOf(c.id),
    suiteRef,
    title,
    description: text(c.description),
    preconditions: text(c.preconditions),
    postconditions: text(c.postconditions),
    priority: priorityOf(c.priority),
    tags: tagsOf(c),
    parameters: parametersOf(c.params),
    steps: stepsOf(c.steps),
  };
}

/** Read a Qase JSON export. Throws QaseFormatError when it is not one. */
export function parseQaseExport(raw: unknown): QasePlan {
  if (!isObject(raw) || !Array.isArray(raw.suites)) throw new QaseFormatError();
  const plan: QasePlan = { suites: [], cases: [] };
  const loose = asArray(raw.cases);
  if (loose.length) {
    plan.suites.push({ externalRef: NO_SUITE_REF, parentRef: null, name: "Without suite", description: null });
    for (const c of loose) plan.cases.push(caseOf(c, NO_SUITE_REF));
  }
  const walk = (s: unknown, parentRef: string | null) => {
    if (!isObject(s)) throw new QaseFormatError();
    const suite = s as RawSuite;
    const ref = idOf(suite.id);
    plan.suites.push({ externalRef: ref, parentRef, name: text(suite.title) ?? "Untitled suite", description: text(suite.description) });
    for (const c of asArray(suite.cases)) plan.cases.push(caseOf(c, ref));
    for (const child of asArray(suite.suites)) walk(child, ref);
  };
  for (const s of raw.suites) walk(s, null);
  return plan;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportSuite = { id: string; parentId: string | null; name: string; description: string | null; externalRef: string | null };
export type ExportCase = {
  id: string;
  suiteId: string;
  externalRef: string | null;
  title: string;
  description: string | null;
  preconditions: string | null;
  postconditions: string | null;
  priority: string;
  testLevel: string;
  tags: string[];
  parameters: unknown;
  steps: unknown;
};

type QaseOutStep = { position: number; action: string; expected_result: string; data: string; steps: QaseOutStep[] };
export type QaseOutCase = Record<string, unknown> & { id: number; steps: QaseOutStep[] };
export type QaseOutSuite = { id: number; title: string; description: string | null; preconditions: null; suites: QaseOutSuite[]; cases: QaseOutCase[] };

const out = (v: unknown) => (typeof v === "string" && v !== NO_EXPECTED ? v : "");

function outSteps(raw: unknown): QaseOutStep[] {
  return asArray(raw).filter(isObject).map((s, i) => ({
    position: i + 1,
    action: out(s.action),
    expected_result: out(s.expected),
    data: out(s.data),
    steps: asArray(s.substeps).filter(isObject).map((x, j) => ({
      position: j + 1, action: out(x.action), expected_result: out(x.expected), data: out(x.data), steps: [],
    })),
  }));
}

/**
 * Build a Qase JSON export from a project's suites and cases. Items imported
 * from Qase keep their Qase id; the rest get fresh numbers above them.
 */
export function buildQaseExport(suites: ExportSuite[], cases: ExportCase[]): { suites: QaseOutSuite[]; cases: QaseOutCase[] } {
  const numeric = [...suites, ...cases].map((x) => Number(x.externalRef)).filter((n) => Number.isSafeInteger(n) && n > 0);
  let next = numeric.length ? Math.max(...numeric) + 1 : 1;
  const idFor = (ref: string | null) => {
    const n = Number(ref);
    return Number.isSafeInteger(n) && n > 0 ? n : next++;
  };

  const casesBySuite = new Map<string, ExportCase[]>();
  for (const c of cases) casesBySuite.set(c.suiteId, [...(casesBySuite.get(c.suiteId) ?? []), c]);

  const caseOut = (c: ExportCase): QaseOutCase => {
    const attr: Record<string, string> = {};
    const tags: string[] = [];
    for (const tag of c.tags) {
      const [prefix, ...rest] = tag.split(":");
      if ((ATTRIBUTE_TAGS as readonly string[]).includes(prefix) && rest.length && !(prefix in attr)) attr[prefix] = rest.join(":");
      else tags.push(tag);
    }
    return {
      id: idFor(c.externalRef),
      title: c.title,
      description: c.description,
      preconditions: c.preconditions,
      postconditions: c.postconditions,
      priority: c.priority === "LOW" ? "low" : c.priority === "MEDIUM" ? "medium" : "high",
      severity: attr.severity ?? "undefined",
      type: attr.type ?? "other",
      behavior: attr.behavior ?? "undefined",
      automation: "is-not-automated",
      status: "actual",
      is_flaky: "no",
      layer: attr.layer ?? "unknown",
      milestone: null,
      custom_fields: [],
      steps_type: "classic",
      steps: outSteps(c.steps),
      tags,
      params: parametersOf(c.parameters),
      is_muted: "no",
    };
  };

  const suiteOut = (s: ExportSuite): QaseOutSuite => ({
    id: idFor(s.externalRef),
    title: s.name,
    description: s.description,
    preconditions: null,
    suites: suites.filter((x) => x.parentId === s.id).map(suiteOut),
    cases: (casesBySuite.get(s.id) ?? []).map(caseOut),
  });

  return { suites: suites.filter((s) => s.parentId === null).map(suiteOut), cases: [] };
}
