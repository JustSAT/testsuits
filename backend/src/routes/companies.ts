import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { AuthedRequest, requireManager } from "../middleware/auth";
import { httpError } from "../middleware/error";
import { logger } from "../lib/logger";

export const companiesRouter = Router();

companiesRouter.get("/current", async (req: AuthedRequest, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user!.companyId },
      include: { _count: { select: { users: true, projects: true } } },
    });
    if (!company) throw httpError(404, "COMPANY_NOT_FOUND");
    res.json(company);
  } catch (e) {
    next(e);
  }
});

// The logo is a small image kept inline as a data URL (no object storage).
const MAX_LOGO_CHARS = 400_000;
const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  logo: z
    .string()
    .max(MAX_LOGO_CHARS)
    .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/, "PNG, JPEG, WebP or GIF data URL")
    .nullable()
    .optional(),
});

companiesRouter.patch("/current", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const company = await prisma.company.update({
      where: { id: req.user!.companyId },
      data,
    });
    logger.info({ companyId: company.id, updatedBy: req.user!.id, fields: Object.keys(data) }, "company updated");
    res.json(company);
  } catch (e) {
    next(e);
  }
});
