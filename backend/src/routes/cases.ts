import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { AuthedRequest, requireManager } from "../middleware/auth";
import { httpError } from "../middleware/error";
import { caseWhere, runWhere, suiteWhere } from "../middleware/scope";
import { logActivity } from "../lib/activity";
import { logger } from "../lib/logger";

export const casesRouter = Router();

// A substep is a check inside a step (Qase's "Substeps"); its expected result
// may be left out.
const substepSchema = z.object({
  action: z.string().trim().min(1, "Substep action cannot be empty"),
  expected: z.string().trim().optional(),
  data: z.string().optional(),
});

const stepSchema = z.object({
  action: z.string().trim().min(1, "Step action cannot be empty"),
  expected: z.string().trim().min(1, "Step expected result cannot be empty"),
  sharedStepId: z.string().optional().nullable(),
  // Input data for the step (Qase's "Data").
  data: z.string().optional(),
  substeps: z.array(substepSchema).optional(),
});

// Parameter groups: the n-th value of every parameter forms one row.
const parameterSchema = z.object({
  title: z.string().trim().min(1, "Parameter name cannot be empty"),
  values: z.array(z.string()),
});

const customFieldValueSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

const upsertSchema = z.object({
  suiteId: z.string(),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().optional().nullable(),
  preconditions: z.string().optional().nullable(),
  postconditions: z.string().optional().nullable(),
  parameters: z.array(parameterSchema).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  testLevel: z.enum(["SMOKE", "SANITY", "REGRESSION", "ADVANCED", "EXPLORATORY"]).optional(),
  tags: z.array(z.string()).optional(),
  steps: z.array(stepSchema).optional(),
  estimatedMinutes: z.number().int().positive().optional().nullable(),
  requirements: z.array(z.string()).optional(),
  customFieldValues: customFieldValueSchema.optional(),
});

casesRouter.post("/", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const data = upsertSchema.parse(req.body);
    const suite = await prisma.testSuite.findFirst({ where: suiteWhere(req.user!, { id: data.suiteId }), select: { id: true } });
    if (!suite) throw httpError(404, "SUITE_NOT_FOUND");
    const testCase = await prisma.testCase.create({
      data: {
        ...data,
        steps: data.steps ?? [],
        parameters: data.parameters ?? [],
        tags: data.tags ?? [],
        requirements: data.requirements ?? [],
        customFieldValues: data.customFieldValues ?? {},
      },
      include: { suite: true },
    });
    req.log.info({ caseId: testCase.id, suiteId: data.suiteId, userId: req.user!.id }, "case created");
    await logActivity({
      projectId: testCase.suite.projectId,
      userId: req.user!.id,
      action: "CASE_CREATED",
      entityType: "case",
      entityId: testCase.id,
      payload: { title: testCase.title },
    });
    res.status(201).json(testCase);
  } catch (e) {
    next(e);
  }
});

casesRouter.get("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const testCase = await prisma.testCase.findFirst({
      where: caseWhere(req.user!, { id: req.params.id }),
      include: {
        suite: { include: { project: true } },
        attachments: { include: { uploadedBy: { select: { id: true, name: true } } } },
        cloneOf: { select: { id: true, title: true } },
        requirementLinks: { select: { id: true, externalRef: true, title: true } },
      },
    });
    if (!testCase) throw httpError(404, "CASE_NOT_FOUND");
    res.json(testCase);
  } catch (e) {
    next(e);
  }
});

casesRouter.patch("/:id", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const current = await prisma.testCase.findFirst({ where: caseWhere(req.user!, { id: req.params.id }) });
    if (!current) throw httpError(404, "CASE_NOT_FOUND");
    const data = upsertSchema.partial().parse(req.body);
    if (data.suiteId && data.suiteId !== current.suiteId) {
      const [from, to] = await Promise.all([
        prisma.testSuite.findUnique({ where: { id: current.suiteId }, select: { projectId: true } }),
        prisma.testSuite.findFirst({ where: suiteWhere(req.user!, { id: data.suiteId }), select: { projectId: true } }),
      ]);
      if (!to || to.projectId !== from?.projectId) {
        req.log.warn({ caseId: current.id, suiteId: data.suiteId, userId: req.user!.id }, "case move: suite outside project");
        throw httpError(400, "CASE_INVALID_SUITE");
      }
    }

    // Snapshot current state into history before overwriting.
    const last = await prisma.testCaseRevision.findFirst({
      where: { caseId: current.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    await prisma.testCaseRevision.create({
      data: {
        caseId: current.id,
        version: (last?.version ?? 0) + 1,
        title: current.title,
        description: current.description,
        preconditions: current.preconditions,
        postconditions: current.postconditions,
        parameters: current.parameters as any,
        priority: current.priority,
        testLevel: current.testLevel,
        tags: current.tags,
        steps: current.steps as any,
        estimatedMinutes: current.estimatedMinutes,
        requirements: current.requirements,
        customFieldValues: current.customFieldValues as any,
        authorId: req.user!.id,
      },
    });

    const testCase = await prisma.testCase.update({
      where: { id: req.params.id },
      data: {
        ...data,
        ...(data.steps ? { steps: data.steps } : {}),
      },
      include: { suite: true },
    });
    req.log.info({ caseId: req.params.id, userId: req.user!.id }, "case updated");
    await logActivity({
      projectId: testCase.suite.projectId,
      userId: req.user!.id,
      action: "CASE_UPDATED",
      entityType: "case",
      entityId: testCase.id,
      payload: { title: testCase.title },
    });
    res.json(testCase);
  } catch (e) {
    next(e);
  }
});

/**
 * Every execution of this case across the project's runs, newest run first:
 * the case panel's Runs and Defects tabs. Testers see the runs they may open.
 */
casesRouter.get("/:id/executions", async (req: AuthedRequest, res, next) => {
  try {
    const owned = await prisma.testCase.findFirst({ where: caseWhere(req.user!, { id: req.params.id }), select: { id: true } });
    if (!owned) throw httpError(404, "CASE_NOT_FOUND");
    const executions = await prisma.testExecution.findMany({
      where: { caseId: owned.id, run: runWhere(req.user!) },
      orderBy: { run: { createdAt: "desc" } },
      take: 200,
      select: {
        id: true,
        status: true,
        executedAt: true,
        jiraIssueKey: true,
        jiraIssueUrl: true,
        executedBy: { select: { id: true, name: true } },
        assignee: { select: { id: true, name: true } },
        run: { select: { id: true, name: true, status: true, environment: true, createdAt: true } },
        results: { select: { id: true, status: true, platform: true, connectivity: true, locale: true, jiraIssueKey: true, jiraIssueUrl: true } },
      },
    });
    res.json(executions);
  } catch (e) {
    next(e);
  }
});

casesRouter.get("/:id/revisions", async (req: AuthedRequest, res, next) => {
  try {
    const owned = await prisma.testCase.findFirst({ where: caseWhere(req.user!, { id: req.params.id }), select: { id: true } });
    if (!owned) throw httpError(404, "CASE_NOT_FOUND");
    const rows = await prisma.testCaseRevision.findMany({
      where: { caseId: owned.id },
      orderBy: { version: "desc" },
      take: 100,
    });
    // Attach author names in a single round-trip.
    const authorIds = Array.from(new Set(rows.map((r) => r.authorId).filter(Boolean) as string[]));
    const authors = authorIds.length
      ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
      : [];
    const byId = new Map(authors.map((a) => [a.id, a]));
    res.json(rows.map((r) => ({ ...r, author: r.authorId ? byId.get(r.authorId) ?? null : null })));
  } catch (e) {
    next(e);
  }
});

casesRouter.delete("/:id", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const owned = await prisma.testCase.findFirst({ where: caseWhere(req.user!, { id: req.params.id }), select: { id: true } });
    if (!owned) throw httpError(404, "CASE_NOT_FOUND");
    await prisma.testCase.delete({ where: { id: req.params.id } });
    req.log.info({ caseId: req.params.id, userId: req.user!.id }, "case deleted");
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

casesRouter.post("/:id/clone", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const target = z.object({ suiteId: z.string().optional() }).parse(req.body);
    const source = await prisma.testCase.findFirst({
      where: caseWhere(req.user!, { id: req.params.id }),
      include: { suite: true },
    });
    if (!source) throw httpError(404, "CASE_NOT_FOUND");
    if (target.suiteId) {
      const dest = await prisma.testSuite.findFirst({ where: suiteWhere(req.user!, { id: target.suiteId }), select: { id: true } });
      if (!dest) throw httpError(404, "DESTINATION_SUITE_NOT_FOUND");
    }
    const cloned = await prisma.testCase.create({
      data: {
        suiteId: target.suiteId ?? source.suiteId,
        title: `${source.title} (copy)`,
        description: source.description,
        preconditions: source.preconditions,
        postconditions: source.postconditions,
        parameters: source.parameters as any,
        priority: source.priority,
        testLevel: source.testLevel,
        tags: source.tags,
        steps: source.steps as any,
        estimatedMinutes: source.estimatedMinutes,
        requirements: source.requirements,
        cloneOfId: source.id,
      },
      include: { suite: true },
    });
    req.log.info({ originalId: req.params.id, cloneId: cloned.id, userId: req.user!.id }, "case cloned");
    await logActivity({
      projectId: cloned.suite.projectId,
      userId: req.user!.id,
      action: "CASE_CLONED",
      entityType: "case",
      entityId: cloned.id,
      payload: { sourceId: source.id, title: cloned.title },
    });
    res.status(201).json(cloned);
  } catch (e) {
    next(e);
  }
});
