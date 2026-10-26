// Suite tree and selection logic for the run case picker. DOM-free so it is
// unit-tested on its own; CasePickerModal only renders what this derives.

export type PickerSuite = { id: string; parentId: string | null; name: string; description?: string | null };
export type PickerCase = { id: string; suiteId: string; title: string; priority: string; testLevel: string; tags: string[] };
export type CaseTreeData = { suites: PickerSuite[]; cases: PickerCase[] };

export type SuiteNode = PickerSuite & {
  children: SuiteNode[];
  /** Cases filed directly in this suite. */
  cases: PickerCase[];
  /** Every case in this suite and its sub-suites, own cases first, depth-first. */
  allCaseIds: string[];
  /** Root → this suite, for the breadcrumb. */
  path: SuiteNode[];
};

export type CaseTree = { roots: SuiteNode[]; byId: Map<string, SuiteNode>; cases: PickerCase[] };

export function buildCaseTree(data: CaseTreeData): CaseTree {
  const byId = new Map<string, SuiteNode>();
  for (const s of data.suites) byId.set(s.id, { ...s, children: [], cases: [], allCaseIds: [], path: [] });
  const roots: SuiteNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  for (const c of data.cases) byId.get(c.suiteId)?.cases.push(c);

  const fill = (node: SuiteNode, parents: SuiteNode[]) => {
    node.path = [...parents, node];
    for (const child of node.children) fill(child, node.path);
    node.allCaseIds = [...node.cases.map((c) => c.id), ...node.children.flatMap((c) => c.allCaseIds)];
  };
  roots.forEach((r) => fill(r, []));
  return { roots, byId, cases: data.cases };
}

export type SelectionState = { selected: number; total: number; state: "none" | "some" | "all" };

/** How much of a suite's subtree is selected. */
export function suiteState(node: SuiteNode, selected: Set<string>): SelectionState {
  const total = node.allCaseIds.length;
  const count = node.allCaseIds.reduce((n, id) => n + (selected.has(id) ? 1 : 0), 0);
  const state = count === 0 ? "none" : count === total ? "all" : "some";
  return { selected: count, total, state };
}

/**
 * Checkbox behaviour for a group of cases: if any is unselected, select them
 * all; if all are selected, clear them. Returns a new set.
 */
export function toggleCases(selected: Set<string>, ids: string[]): Set<string> {
  const next = new Set(selected);
  const allOn = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** Cases whose title contains the query, case-insensitive. Empty query → none. */
export function matchCases(tree: CaseTree, query: string): PickerCase[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return tree.cases.filter((c) => c.title.toLowerCase().includes(q));
}

/** Fields the picker's "Add filter" can narrow the list by. */
export const CASE_FILTER_FIELDS = ["priority", "testLevel", "tags"] as const;
export type CaseFilterField = (typeof CASE_FILTER_FIELDS)[number];
export type CaseFilters = Partial<Record<CaseFilterField, string[]>>;

/**
 * Cases matching every filter that has values; within a field any chosen
 * value matches (for tags: a case carrying any of them). Filters only narrow
 * what the picker shows — they never drop a case already picked.
 */
export function filterCases(cases: PickerCase[], filters: CaseFilters): PickerCase[] {
  const active = CASE_FILTER_FIELDS.filter((f) => (filters[f]?.length ?? 0) > 0);
  if (active.length === 0) return cases;
  return cases.filter((c) =>
    active.every((f) => {
      const wanted = filters[f]!;
      return f === "tags" ? c.tags.some((tag) => wanted.includes(tag)) : wanted.includes(c[f]);
    }),
  );
}

/** Every tag used by the given cases, once each, sorted. */
export function caseTags(cases: PickerCase[]): string[] {
  return Array.from(new Set(cases.flatMap((c) => c.tags))).sort();
}

export type ParentOption = { id: string; name: string; depth: number };

/**
 * Suites in tree order with their depth, for a "parent suite" select. When
 * `excludeId` is given, that suite and its sub-suites are left out: a suite
 * cannot move under itself.
 */
export function parentOptions(tree: CaseTree, excludeId?: string): ParentOption[] {
  const out: ParentOption[] = [];
  const walk = (nodes: SuiteNode[], depth: number) => {
    for (const n of nodes) {
      if (n.id === excludeId) continue;
      out.push({ id: n.id, name: n.name, depth });
      walk(n.children, depth + 1);
    }
  };
  walk(tree.roots, 0);
  return out;
}

/** How many suites (sub-suites included) and cases a delete would remove. */
export function deletionImpact(tree: CaseTree, suiteIds: string[], caseIds: string[]): { suites: number; cases: number } {
  const suites = new Set<string>();
  const cases = new Set<string>(caseIds);
  const walk = (n: SuiteNode) => {
    suites.add(n.id);
    n.cases.forEach((c) => cases.add(c.id));
    n.children.forEach(walk);
  };
  for (const id of suiteIds) {
    const node = tree.byId.get(id);
    if (node) walk(node);
  }
  return { suites: suites.size, cases: cases.size };
}
