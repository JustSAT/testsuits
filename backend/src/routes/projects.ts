import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { prisma } from "../db";
import { AuthedRequest, requireManager } from "../middleware/auth";
import { httpError } from "../middleware/error";
import { projectWhere } from "../middleware/scope";
import { logger } from "../lib/logger";
import { logActivity } from "../lib/activity";
import { suiteCaseTotals } from "../lib/suiteTree";

export const projectsRouter = Router();

const upsertSchema = z.object({
  key: z.string().trim().min(1).max(16).regex(/^[A-Z0-9_-]+$/),
  name: z.string().trim().min(1, "Project name is required"),
  description: z.string().optional().nullable(),
});

const customFieldTypes = ["text", "textarea", "number", "select", "checkbox"] as const;
const customFieldSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().trim().min(1, "Field label is required").max(80),
  type: z.enum(customFieldTypes),
  required: z.boolean().optional(),
  options: z.array(z.string().trim().min(1)).optional(),
});
export type CustomField = {
  id: string;
  label: string;
  type: typeof customFieldTypes[number];
  required: boolean;
  options?: string[];
};

projectsRouter.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const projects = await prisma.project.findMany({
      where: projectWhere(req.user!),
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { suites: true, runs: true } } },
    });
    res.json(projects);
  } catch (e) {
    next(e);
  }
});

projectsRouter.post("/", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const data = upsertSchema.parse(req.body);
    const project = await prisma.project.create({
      data: { ...data, companyId: req.user!.companyId },
    });
    logger.info({ projectId: project.id, companyId: project.companyId, createdBy: req.user!.id }, "project created");
    res.status(201).json(project);
  } catch (e) {
    next(e);
  }
});

projectsRouter.get("/:id", async (req: AuthedRequest, res, next) => {
  try {
    const project = await prisma.project.findFirst({
      where: projectWhere(req.user!, { id: req.params.id }),
      include: {
        suites: {
          where: { parentId: null },
          include: { children: true, _count: { select: { cases: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!project) throw httpError(404, "PROJECT_NOT_FOUND");
    const totals = await suiteCaseTotals(project.id);
    res.json({ ...project, suites: project.suites.map((s) => ({ ...s, totalCases: totals.get(s.id) ?? 0 })) });
  } catch (e) {
    next(e);
  }
});

/**
 * Every suite and case of a project, flat, for the run case picker. Cases carry
 * only what the picker shows; the client builds the tree from `parentId`.
 */
projectsRouter.get("/:id/case-tree", async (req: AuthedRequest, res, next) => {
  try {
    const project = await prisma.project.findFirst({ where: projectWhere(req.user!, { id: req.params.id }), select: { id: true } });
    if (!project) throw httpError(404, "PROJECT_NOT_FOUND");
    const [suites, cases] = await Promise.all([
      prisma.testSuite.findMany({
        where: { projectId: project.id },
        select: { id: true, parentId: true, name: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.testCase.findMany({
        where: { suite: { projectId: project.id } },
        select: { id: true, suiteId: true, title: true, priority: true, testLevel: true, tags: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    req.log.info({ projectId: project.id, userId: req.user!.id, suites: suites.length, cases: cases.length }, "case tree served");
    res.json({ suites, cases });
  } catch (e) {
    next(e);
  }
});

projectsRouter.patch("/:id", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const owned = await prisma.project.findFirst({ where: projectWhere(req.user!, { id: req.params.id }), select: { id: true } });
    if (!owned) throw httpError(404, "PROJECT_NOT_FOUND");
    const data = upsertSchema.partial().parse(req.body);
    const project = await prisma.project.update({ where: { id: req.params.id }, data });
    logger.info({ projectId: project.id, updatedBy: req.user!.id }, "project updated");
    res.json(project);
  } catch (e) {
    next(e);
  }
});

projectsRouter.delete("/:id", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const owned = await prisma.project.findFirst({ where: projectWhere(req.user!, { id: req.params.id }), select: { id: true } });
    if (!owned) throw httpError(404, "PROJECT_NOT_FOUND");
    await prisma.project.delete({ where: { id: req.params.id } });
    logger.info({ projectId: req.params.id, deletedBy: req.user!.id }, "project deleted");
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

projectsRouter.get("/:id/custom-fields", async (req: AuthedRequest, res, next) => {
  try {
    const project = await prisma.project.findFirst({
      where: projectWhere(req.user!, { id: req.params.id }),
      select: { id: true, customFields: true },
    });
    if (!project) throw httpError(404, "PROJECT_NOT_FOUND");
    res.json((project.customFields as unknown as CustomField[]) ?? []);
  } catch (e) {
    next(e);
  }
});

projectsRouter.put("/:id/custom-fields", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const owned = await prisma.project.findFirst({
      where: projectWhere(req.user!, { id: req.params.id }),
      select: { id: true },
    });
    if (!owned) throw httpError(404, "PROJECT_NOT_FOUND");
    const input = z.array(customFieldSchema).max(40).parse(req.body);
    const normalised: CustomField[] = input.map((f) => {
      if (f.type === "select" && (!f.options || f.options.length === 0)) {
        throw httpError(400, "CUSTOM_FIELD_REQUIRES_OPTIONS");
      }
      return {
        id: f.id && /^[a-z0-9-]{8,}$/i.test(f.id) ? f.id : randomUUID(),
        label: f.label,
        type: f.type,
        required: f.required ?? false,
        ...(f.type === "select" ? { options: f.options } : {}),
      };
    });
    await prisma.project.update({
      where: { id: req.params.id },
      data: { customFields: normalised as unknown as object },
    });
    await logActivity({
      projectId: req.params.id,
      userId: req.user!.id,
      action: "CUSTOM_FIELDS_UPDATED",
      entityType: "project",
      entityId: req.params.id,
      payload: { count: normalised.length },
    });
    req.log?.info({ projectId: req.params.id, count: normalised.length }, "custom fields updated");
    res.json(normalised);
  } catch (e) {
    next(e);
  }
});
