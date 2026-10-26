import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { AuthedRequest, requireManager } from "../middleware/auth";
import { httpError } from "../middleware/error";
import { projectWhere } from "../middleware/scope";

/** A project's environments (Qase's Environments), picked from a list when a run is created. */
export const environmentsRouter = Router();

const fieldsSchema = z.object({
  title: z.string().trim().min(1),
  slug: z.string().trim().regex(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, digits and dashes"),
  description: z.string().trim().optional().nullable(),
  type: z.enum(["DYNAMIC", "STATIC"]),
  host: z.string().trim().min(1),
});
const createSchema = fieldsSchema.extend({ projectId: z.string().min(1) });

function isSlugClash(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function ownedEnvironment(req: AuthedRequest) {
  const env = await prisma.environment.findFirst({
    where: { id: req.params.id, project: projectWhere(req.user!) },
    select: { id: true, projectId: true },
  });
  if (!env) throw httpError(404, "ENVIRONMENT_NOT_FOUND");
  return env;
}

environmentsRouter.get("/", async (req: AuthedRequest, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.query.projectId);
    const project = await prisma.project.findFirst({ where: projectWhere(req.user!, { id: projectId }), select: { id: true } });
    if (!project) throw httpError(404, "PROJECT_NOT_FOUND");
    const [environments, lastRuns] = await Promise.all([
      prisma.environment.findMany({
        where: { projectId },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { runs: true } } },
      }),
      prisma.testRun.groupBy({ by: ["environmentId"], where: { projectId, environmentId: { not: null } }, _max: { createdAt: true } }),
    ]);
    const lastById = new Map(lastRuns.map((r) => [r.environmentId, r._max.createdAt]));
    res.json(environments.map(({ _count, ...e }) => ({ ...e, runCount: _count.runs, lastRunAt: lastById.get(e.id) ?? null })));
  } catch (e) {
    next(e);
  }
});

environmentsRouter.post("/", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const project = await prisma.project.findFirst({ where: projectWhere(req.user!, { id: data.projectId }), select: { id: true } });
    if (!project) throw httpError(404, "PROJECT_NOT_FOUND");
    const env = await prisma.environment.create({ data }).catch((e) => {
      if (isSlugClash(e)) throw httpError(409, "ENVIRONMENT_SLUG_TAKEN");
      throw e;
    });
    req.log.info({ environmentId: env.id, projectId: env.projectId, userId: req.user!.id }, "environment created");
    res.status(201).json(env);
  } catch (e) {
    next(e);
  }
});

environmentsRouter.patch("/:id", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const owned = await ownedEnvironment(req);
    const data = fieldsSchema.partial().parse(req.body);
    const env = await prisma.environment.update({ where: { id: owned.id }, data }).catch((e) => {
      if (isSlugClash(e)) throw httpError(409, "ENVIRONMENT_SLUG_TAKEN");
      throw e;
    });
    // Runs show the environment by its stored title; keep it in step with a rename.
    if (data.title) await prisma.testRun.updateMany({ where: { environmentId: env.id }, data: { environment: env.title } });
    req.log.info({ environmentId: env.id, userId: req.user!.id }, "environment updated");
    res.json(env);
  } catch (e) {
    next(e);
  }
});

environmentsRouter.delete("/:id", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const owned = await ownedEnvironment(req);
    await prisma.environment.delete({ where: { id: owned.id } });
    req.log.info({ environmentId: owned.id, projectId: owned.projectId, userId: req.user!.id }, "environment deleted");
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
