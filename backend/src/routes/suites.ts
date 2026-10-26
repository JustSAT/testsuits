import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { AuthedRequest, requireManager } from "../middleware/auth";
import { httpError } from "../middleware/error";
import { projectWhere, suiteWhere } from "../middleware/scope";
import { logger } from "../lib/logger";
import { expandSuiteIds, isValidParent, suiteCaseTotals } from "../lib/suiteTree";

export const suitesRouter = Router();

const createSchema = z.object({
  projectId: z.string(),
  parentId: z.string().optional().nullable(),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

suitesRouter.post("/", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const project = await prisma.project.findFirst({ where: projectWhere(req.user!, { id: data.projectId }), select: { id: true } });
    if (!project) throw httpError(404, "PROJECT_NOT_FOUND");
    if (data.parentId && !(await isValidParent(project.id, null, data.parentId))) {
      req.log.warn({ projectId: project.id, parentId: data.parentId, userId: req.user!.id }, "suite create: invalid parent");
      throw httpError(400, "SUITE_INVALID_PARENT");
    }
    const suite = await prisma.testSuite.create({ data });
    req.log.info({ suiteId: suite.id, projectId: data.projectId, userId: req.user!.id }, "suite created");
    res.status(201).json(suite);
  } catch (e) {
    next(e);
  }
});

suitesRouter.get("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const suite = await prisma.testSuite.findFirst({
      where: suiteWhere(req.user!, { id: req.params.id }),
      include: {
        children: { include: { _count: { select: { cases: true } } } },
        cases: { orderBy: { createdAt: "asc" } },
        project: true,
      },
    });
    if (!suite) throw httpError(404, "SUITE_NOT_FOUND");
    const totals = await suiteCaseTotals(suite.projectId);
    res.json({
      ...suite,
      totalCases: totals.get(suite.id) ?? 0,
      children: suite.children.map((c) => ({ ...c, totalCases: totals.get(c.id) ?? 0 })),
    });
  } catch (e) {
    next(e);
  }
});

suitesRouter.patch("/:id", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const owned = await prisma.testSuite.findFirst({ where: suiteWhere(req.user!, { id: req.params.id }), select: { id: true, projectId: true } });
    if (!owned) throw httpError(404, "SUITE_NOT_FOUND");
    const data = createSchema.partial().omit({ projectId: true }).parse(req.body);
    if (data.parentId && !(await isValidParent(owned.projectId, owned.id, data.parentId))) {
      req.log.warn({ suiteId: owned.id, parentId: data.parentId, userId: req.user!.id }, "suite move: invalid parent");
      throw httpError(400, "SUITE_INVALID_PARENT");
    }
    const suite = await prisma.testSuite.update({ where: { id: req.params.id }, data });
    req.log.info({ suiteId: req.params.id, userId: req.user!.id }, "suite updated");
    res.json(suite);
  } catch (e) {
    next(e);
  }
});

/**
 * Copy a suite next to the original: its sub-suites at every depth and all
 * their cases, in one transaction. Copied cases point at their source through
 * `cloneOfId`; executions, comments and attachments are not copied.
 */
suitesRouter.post("/:id/duplicate", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const { name } = z.object({ name: z.string().trim().min(1).optional() }).parse(req.body ?? {});
    const source = await prisma.testSuite.findFirst({ where: suiteWhere(req.user!, { id: req.params.id }) });
    if (!source) throw httpError(404, "SUITE_NOT_FOUND");

    const { ids } = await expandSuiteIds(source.projectId, [source.id]);
    const [suites, cases] = await Promise.all([
      prisma.testSuite.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: "asc" } }),
      prisma.testCase.findMany({ where: { suiteId: { in: ids } }, orderBy: { createdAt: "asc" } }),
    ]);

    const copy = await prisma.$transaction(async (tx) => {
      const newIds = new Map<string, string>();
      const make = async (suiteId: string, parentId: string | null, rename?: string): Promise<string> => {
        const s = suites.find((x) => x.id === suiteId)!;
        const created = await tx.testSuite.create({
          data: { projectId: s.projectId, parentId, name: rename ?? s.name, description: s.description },
        });
        newIds.set(s.id, created.id);
        for (const child of suites.filter((x) => x.parentId === s.id)) await make(child.id, created.id);
        return created.id;
      };
      const rootId = await make(source.id, source.parentId, name ?? `${source.name} (copy)`);
      await tx.testCase.createMany({
        data: cases.map((c) => ({
          suiteId: newIds.get(c.suiteId)!,
          title: c.title,
          description: c.description,
          preconditions: c.preconditions,
          postconditions: c.postconditions,
          parameters: c.parameters as object,
          priority: c.priority,
          testLevel: c.testLevel,
          tags: c.tags,
          steps: c.steps as object,
          estimatedMinutes: c.estimatedMinutes,
          requirements: c.requirements,
          customFieldValues: c.customFieldValues as object,
          cloneOfId: c.id,
        })),
      });
      return tx.testSuite.findUniqueOrThrow({ where: { id: rootId } });
    });

    req.log.info(
      { sourceSuiteId: source.id, suiteId: copy.id, suites: suites.length, cases: cases.length, userId: req.user!.id },
      "suite duplicated",
    );
    res.status(201).json(copy);
  } catch (e) {
    next(e);
  }
});

suitesRouter.delete("/:id", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const owned = await prisma.testSuite.findFirst({ where: suiteWhere(req.user!, { id: req.params.id }), select: { id: true } });
    if (!owned) throw httpError(404, "SUITE_NOT_FOUND");
    await prisma.testSuite.delete({ where: { id: req.params.id } });
    req.log.info({ suiteId: req.params.id, userId: req.user!.id }, "suite deleted");
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
