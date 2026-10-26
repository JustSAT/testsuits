import { prisma } from "../db";

type SuiteNode = { id: string; parentId: string | null; direct: number };

/** Every suite of a project with how many cases it holds directly. One query. */
async function loadSuites(projectId: string): Promise<SuiteNode[]> {
  const suites = await prisma.testSuite.findMany({
    where: { projectId },
    select: { id: true, parentId: true, _count: { select: { cases: true } } },
  });
  return suites.map((s) => ({ id: s.id, parentId: s.parentId, direct: s._count.cases }));
}

function childrenOf(suites: SuiteNode[]): Map<string | null, SuiteNode[]> {
  const byParent = new Map<string | null, SuiteNode[]>();
  for (const s of suites) {
    const list = byParent.get(s.parentId) ?? [];
    list.push(s);
    byParent.set(s.parentId, list);
  }
  return byParent;
}

/**
 * Number of cases under each suite of a project, counting every sub-suite at
 * any depth (a suite whose cases all live in sub-suites is not empty).
 */
export async function suiteCaseTotals(projectId: string): Promise<Map<string, number>> {
  const suites = await loadSuites(projectId);
  const byParent = childrenOf(suites);
  const totals = new Map<string, number>();
  const visit = (s: SuiteNode): number => {
    const cached = totals.get(s.id);
    if (cached !== undefined) return cached;
    let total = s.direct;
    for (const child of byParent.get(s.id) ?? []) total += visit(child);
    totals.set(s.id, total);
    return total;
  };
  suites.forEach(visit);
  return totals;
}

/**
 * The given suites plus all their sub-suites, at any depth. Ids that are not
 * suites of the project are returned in `unknown` instead.
 */
export async function expandSuiteIds(projectId: string, rootIds: string[]): Promise<{ ids: string[]; unknown: string[] }> {
  const suites = await loadSuites(projectId);
  const known = new Set(suites.map((s) => s.id));
  const byParent = childrenOf(suites);
  const ids = new Set<string>();
  const unknown: string[] = [];
  const stack = rootIds.filter((id) => {
    if (known.has(id)) return true;
    unknown.push(id);
    return false;
  });
  while (stack.length) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    for (const child of byParent.get(id) ?? []) stack.push(child.id);
  }
  return { ids: Array.from(ids), unknown };
}

/**
 * Whether `parentId` may become the parent of `suiteId` (a new suite when
 * `suiteId` is null): it must be a suite of the same project, and not the
 * suite itself or one of its sub-suites.
 */
export async function isValidParent(projectId: string, suiteId: string | null, parentId: string): Promise<boolean> {
  const suites = await loadSuites(projectId);
  if (!suites.some((s) => s.id === parentId)) return false;
  if (!suiteId) return true;
  const { ids } = await expandSuiteIds(projectId, [suiteId]);
  return !ids.includes(parentId);
}
