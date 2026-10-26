import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { buildQaseExport, type QasePlan } from "./qase";

export type QaseImportSummary = {
  suitesCreated: number;
  suitesUpdated: number;
  casesCreated: number;
  casesUpdated: number;
  casesUnchanged: number;
};

const DRY_RUN = Symbol("qase import dry run");

type Tx = Prisma.TransactionClient;
type SuiteRow = { id: string; parentId: string | null; name: string; description: string | null; externalRef: string | null };
type CaseRow = Awaited<ReturnType<typeof loadCases>>[number];

function loadCases(tx: Tx, projectId: string) {
  return tx.testCase.findMany({ where: { suite: { projectId } } });
}

/** JSON with object keys sorted: Postgres jsonb does not keep key order. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v ?? null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Create or update a project's suites and cases from a Qase export plan, in
 * one transaction. Suites and cases are matched by their Qase id first; items
 * that have none yet (made here, or imported before through Excel) are matched
 * by suite path and title, then remember the Qase id. A matched case whose
 * content changed is updated with a revision of its previous state; nothing
 * is ever deleted. With `dryRun` the import runs and is rolled back.
 */
export async function applyQaseImport(projectId: string, authorId: string, plan: QasePlan, dryRun: boolean): Promise<QaseImportSummary> {
  const summary: QaseImportSummary = { suitesCreated: 0, suitesUpdated: 0, casesCreated: 0, casesUpdated: 0, casesUnchanged: 0 };
  try {
    await prisma.$transaction(
      async (tx) => {
        await run(tx, projectId, authorId, plan, summary);
        if (dryRun) throw DRY_RUN;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (e !== DRY_RUN) throw e;
  }
  return summary;
}

async function run(tx: Tx, projectId: string, authorId: string, plan: QasePlan, summary: QaseImportSummary) {
  const suites: SuiteRow[] = await tx.testSuite.findMany({
    where: { projectId },
    select: { id: true, parentId: true, name: true, description: true, externalRef: true },
  });
  const suiteIdByRef = new Map<string, string>();

  for (const ps of plan.suites) {
    const parentId = ps.parentRef ? suiteIdByRef.get(ps.parentRef) ?? null : null;
    const match =
      suites.find((s) => s.externalRef === ps.externalRef) ??
      suites.find((s) => !s.externalRef && s.parentId === parentId && s.name === ps.name);
    if (!match) {
      const created = await tx.testSuite.create({
        data: { projectId, parentId, name: ps.name, description: ps.description, externalRef: ps.externalRef },
      });
      suites.push(created);
      suiteIdByRef.set(ps.externalRef, created.id);
      summary.suitesCreated++;
      continue;
    }
    const changed = match.name !== ps.name || match.parentId !== parentId || (match.description ?? null) !== ps.description;
    if (changed || match.externalRef !== ps.externalRef) {
      await tx.testSuite.update({
        where: { id: match.id },
        data: { name: ps.name, parentId, description: ps.description, externalRef: ps.externalRef },
      });
      Object.assign(match, { name: ps.name, parentId, description: ps.description, externalRef: ps.externalRef });
      if (changed) summary.suitesUpdated++;
    }
    suiteIdByRef.set(ps.externalRef, match.id);
  }

  const cases: CaseRow[] = await loadCases(tx, projectId);
  const claimed = new Set<string>();
  for (const pc of plan.cases) {
    const suiteId = suiteIdByRef.get(pc.suiteRef)!;
    const match =
      cases.find((c) => c.externalRef === pc.externalRef) ??
      cases.find((c) => !c.externalRef && !claimed.has(c.id) && c.suiteId === suiteId && c.title === pc.title);
    const content = {
      suiteId,
      title: pc.title,
      description: pc.description,
      preconditions: pc.preconditions,
      postconditions: pc.postconditions,
      priority: pc.priority,
      tags: pc.tags,
      parameters: pc.parameters as Prisma.InputJsonValue,
      steps: pc.steps as Prisma.InputJsonValue,
    };
    if (!match) {
      await tx.testCase.create({ data: { ...content, externalRef: pc.externalRef } });
      summary.casesCreated++;
      continue;
    }
    claimed.add(match.id);
    // Qase has no "critical": it exports Critical as high, so keep Critical.
    if (pc.priority === "HIGH" && match.priority === "CRITICAL") content.priority = "CRITICAL";
    const changed =
      match.suiteId !== suiteId ||
      match.title !== pc.title ||
      (match.description ?? null) !== pc.description ||
      (match.preconditions ?? null) !== pc.preconditions ||
      (match.postconditions ?? null) !== pc.postconditions ||
      match.priority !== content.priority ||
      !same(match.tags, pc.tags) ||
      !same(match.parameters, pc.parameters) ||
      !same(match.steps, pc.steps);
    if (!changed) {
      if (match.externalRef !== pc.externalRef) {
        await tx.testCase.update({ where: { id: match.id }, data: { externalRef: pc.externalRef } });
      }
      summary.casesUnchanged++;
      continue;
    }
    const last = await tx.testCaseRevision.findFirst({ where: { caseId: match.id }, orderBy: { version: "desc" }, select: { version: true } });
    await tx.testCaseRevision.create({
      data: {
        caseId: match.id,
        version: (last?.version ?? 0) + 1,
        title: match.title,
        description: match.description,
        preconditions: match.preconditions,
        postconditions: match.postconditions,
        parameters: match.parameters as Prisma.InputJsonValue,
        priority: match.priority,
        testLevel: match.testLevel,
        tags: match.tags,
        steps: match.steps as Prisma.InputJsonValue,
        estimatedMinutes: match.estimatedMinutes,
        requirements: match.requirements,
        customFieldValues: match.customFieldValues as Prisma.InputJsonValue,
        authorId,
      },
    });
    await tx.testCase.update({ where: { id: match.id }, data: { ...content, externalRef: pc.externalRef } });
    summary.casesUpdated++;
  }
}

/** A project's suites and cases as a Qase JSON export. */
export async function exportQase(projectId: string) {
  const [suites, cases] = await Promise.all([
    prisma.testSuite.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      select: { id: true, parentId: true, name: true, description: true, externalRef: true },
    }),
    prisma.testCase.findMany({ where: { suite: { projectId } }, orderBy: { createdAt: "asc" } }),
  ]);
  return buildQaseExport(suites, cases);
}
