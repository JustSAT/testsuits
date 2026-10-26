// Suite tree and selection logic for the run case picker. DOM-free so it is
// unit-tested on its own; CasePickerModal only renders what this derives.

export type PickerSuite = { id: string; parentId: string | null; name: string };
export type PickerCase = { id: string; suiteId: string; title: string; priority: string; testLevel: string };
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
