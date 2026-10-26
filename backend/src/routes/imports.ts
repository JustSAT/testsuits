import { Router } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { AuthedRequest, requireManager } from "../middleware/auth";
import { httpError } from "../middleware/error";
import { projectWhere } from "../middleware/scope";
import {
  buildCaseTemplate,
  parseCaseWorkbook,
  ParsedCase,
  RowIssue,
  WorkbookError,
  CASES_SHEET,
  SUITE_PATH_SEPARATOR,
} from "../lib/excelCases";
import { parseQaseExport, QaseFormatError, type QasePlan } from "../lib/qase";
import { applyQaseImport, exportQase } from "../lib/qaseImport";

export const importsRouter = Router();

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const XLSX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  // Some browsers/proxies send a generic type for .xlsx — the filename check
  // below is what actually gates it, and ExcelJS rejects non-workbooks anyway.
  "application/octet-stream",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/**
 * Run multer and translate its errors into our machine-key contract. Without
 * this, an oversized upload surfaces as an opaque 500.
 */
function uploadSingle(field: string) {
  const handler = upload.single(field);
  return (req: AuthedRequest, res: any, next: any) => {
    handler(req as any, res, (err: unknown) => {
      if (!err) return next();
      const code = (err as { code?: string }).code;
      if (code === "LIMIT_FILE_SIZE") return next(httpError(400, "IMPORT_FILE_TOO_LARGE"));
      if (code === "LIMIT_UNEXPECTED_FILE" || code === "LIMIT_FILE_COUNT") {
        return next(httpError(400, "IMPORT_UNEXPECTED_FILE"));
      }
      return next(err);
    });
  };
}

const optionsSchema = z.object({
  projectId: z.string().min(1),
  duplicateStrategy: z.enum(["SKIP", "UPDATE"]).default("SKIP"),
  // Multipart bodies are strings, so accept the stringified booleans too.
  skipInvalidRows: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .default(false)
    .transform((v) => v === true || v === "true"),
});

type ImportOptions = z.infer<typeof optionsSchema>;

type CaseDecision = {
  externalId: string;
  title: string;
  suitePath: string;
  action: "CREATE" | "UPDATE" | "SKIP";
  stepCount: number;
  row: number;
  /** Set when the case already exists (UPDATE / SKIP). */
  existingCaseId?: string;
  /** Real suite id, or a `virtual:n` placeholder for a suite we'd create. */
  suiteRef: string;
};

type ImportPlan = {
  decisions: CaseDecision[];
  /** Display paths of suites that don't exist yet, root-first. */
  suitesToCreate: string[][];
  issues: RowIssue[];
  counts: { create: number; update: number; skip: number; suites: number; steps: number };
};

const VIRTUAL_PREFIX = "virtual:";

/**
 * Namespace for the per-project `pg_advisory_xact_lock` taken during a commit.
 * Advisory locks share one global space, so the namespace keeps the import
 * lock from colliding with any other subsystem that starts using them.
 */
const IMPORT_LOCK_NAMESPACE = 21587;

function suiteKey(parentRef: string | null, name: string) {
  return `${parentRef ?? "#root"}::${name.trim().toLowerCase()}`;
}

function caseKey(suiteRef: string, title: string) {
  return `${suiteRef}::${title.trim().toLowerCase()}`;
}

/**
 * Decide what the import would do, without writing anything. Used verbatim by
 * both the preview endpoint and the commit endpoint so the two can never
 * disagree about the outcome.
 */
async function buildPlan(projectId: string, parsed: ParsedCase[], baseIssues: RowIssue[], opts: ImportOptions): Promise<ImportPlan> {
  // Nothing in the schema stops two sibling suites (or two cases in a suite)
  // from sharing a name, so a key can legitimately collide. Order by creation
  // and keep the FIRST hit, so "which one does UPDATE target" is stable across
  // runs instead of depending on row order coming back from Postgres.
  const [suites, existingCases] = await Promise.all([
    prisma.testSuite.findMany({
      where: { projectId },
      select: { id: true, parentId: true, name: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.testCase.findMany({
      where: { suite: { projectId } },
      select: { id: true, suiteId: true, title: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);

  const suiteRefByKey = new Map<string, string>();
  for (const s of suites) {
    const key = suiteKey(s.parentId, s.name);
    if (!suiteRefByKey.has(key)) suiteRefByKey.set(key, s.id);
  }

  const existingCaseByKey = new Map<string, string>();
  for (const c of existingCases) {
    const key = caseKey(c.suiteId, c.title);
    if (!existingCaseByKey.has(key)) existingCaseByKey.set(key, c.id);
  }

  const issues = [...baseIssues];
  const suitesToCreate: string[][] = [];
  const decisions: CaseDecision[] = [];
  const seenInFile = new Set<string>();
  let virtualCount = 0;

  for (const c of parsed) {
    // Walk the path root-first, reusing existing suites and queueing the rest.
    let parentRef: string | null = null;
    for (let depth = 0; depth < c.suitePath.length; depth++) {
      const segment = c.suitePath[depth];
      const key = suiteKey(parentRef, segment);
      let ref = suiteRefByKey.get(key);
      if (!ref) {
        ref = `${VIRTUAL_PREFIX}${virtualCount++}`;
        suiteRefByKey.set(key, ref);
        suitesToCreate.push(c.suitePath.slice(0, depth + 1));
      }
      parentRef = ref;
    }
    const suiteRef = parentRef!;

    const key = caseKey(suiteRef, c.title);
    if (seenInFile.has(key)) {
      issues.push({
        sheet: CASES_SHEET,
        row: c.row,
        code: "IMPORT_DUPLICATE_IN_FILE",
        value: c.title,
      });
      continue;
    }
    seenInFile.add(key);

    const existingCaseId = existingCaseByKey.get(key);
    const action: CaseDecision["action"] = !existingCaseId
      ? "CREATE"
      : opts.duplicateStrategy === "UPDATE"
        ? "UPDATE"
        : "SKIP";

    decisions.push({
      externalId: c.externalId,
      title: c.title,
      suitePath: c.suitePath.join(` ${SUITE_PATH_SEPARATOR} `),
      action,
      stepCount: c.steps.length,
      row: c.row,
      suiteRef,
      ...(existingCaseId ? { existingCaseId } : {}),
    });
  }

  const counts = {
    create: decisions.filter((d) => d.action === "CREATE").length,
    update: decisions.filter((d) => d.action === "UPDATE").length,
    skip: decisions.filter((d) => d.action === "SKIP").length,
    suites: suitesToCreate.length,
    steps: decisions.reduce((n, d) => (d.action === "SKIP" ? n : n + d.stepCount), 0),
  };

  return { decisions, suitesToCreate, issues, counts };
}

/** Parse + plan, shared by preview and commit. Throws httpError on hard failures. */
async function prepare(req: AuthedRequest) {
  const opts = optionsSchema.parse(req.body ?? {});
  if (!req.file) throw httpError(400, "NO_FILE_UPLOADED");

  const name = req.file.originalname ?? "";
  if (!/\.xlsx$/i.test(name) || !XLSX_MIME_TYPES.has(req.file.mimetype)) {
    req.log.warn(
      { userId: req.user!.id, filename: name, mimetype: req.file.mimetype },
      "case import rejected: not an xlsx upload",
    );
    throw httpError(400, "IMPORT_INVALID_FILE_TYPE");
  }

  const project = await prisma.project.findFirst({
    where: projectWhere(req.user!, { id: opts.projectId }),
    select: { id: true, name: true },
  });
  if (!project) throw httpError(404, "PROJECT_NOT_FOUND");

  let parsed;
  try {
    parsed = await parseCaseWorkbook(req.file.buffer);
  } catch (e) {
    if (e instanceof WorkbookError) {
      req.log.warn(
        { userId: req.user!.id, projectId: project.id, reason: e.message },
        "case import workbook rejected",
      );
      throw httpError(400, e.message);
    }
    throw e;
  }

  const plan = await buildPlan(project.id, parsed.cases, parsed.issues, opts);
  return { opts, project, parsed, plan };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

importsRouter.get("/cases/template.xlsx", requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const buffer = await buildCaseTemplate();
    req.log.info({ userId: req.user!.id, bytes: buffer.length }, "case import template downloaded");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="suitesglobal-case-import-template.xlsx"');
    res.setHeader("Content-Length", String(buffer.length));
    res.end(buffer);
  } catch (e) {
    next(e);
  }
});

/** Dry run: report exactly what a commit would do. Writes nothing. */
importsRouter.post("/cases/preview", requireManager, uploadSingle("file"), async (req: AuthedRequest, res, next) => {
  try {
    const { opts, project, parsed, plan } = await prepare(req);
    req.log.info(
      {
        userId: req.user!.id,
        projectId: project.id,
        parsedCases: parsed.cases.length,
        issues: plan.issues.length,
        counts: plan.counts,
        duplicateStrategy: opts.duplicateStrategy,
      },
      "case import previewed",
    );
    res.json({
      projectId: project.id,
      counts: plan.counts,
      issues: plan.issues,
      skippedBlankRows: parsed.skippedBlankRows,
      suitesToCreate: plan.suitesToCreate.map((p) => p.join(` ${SUITE_PATH_SEPARATOR} `)),
      // Cap the row-level preview so a 1000-case file doesn't ship a huge body.
      // `suiteRef` is an internal planning handle (`virtual:N`) — not for callers.
      decisions: plan.decisions.slice(0, 200).map(({ suiteRef: _suiteRef, ...d }) => d),
      truncated: plan.decisions.length > 200,
      totalDecisions: plan.decisions.length,
    });
  } catch (e) {
    next(e);
  }
});

/** Commit the import. All-or-nothing: one transaction for suites + cases. */
importsRouter.post("/cases", requireManager, uploadSingle("file"), async (req: AuthedRequest, res, next) => {
  try {
    const { opts, project, parsed, plan } = await prepare(req);

    if (plan.issues.length > 0 && !opts.skipInvalidRows) {
      req.log.warn(
        { userId: req.user!.id, projectId: project.id, issues: plan.issues.length },
        "case import refused: file has row errors",
      );
      return res.status(400).json({ error: "IMPORT_HAS_ERRORS", issues: plan.issues });
    }
    if (plan.counts.create === 0 && plan.counts.update === 0) {
      req.log.warn(
        { userId: req.user!.id, projectId: project.id, counts: plan.counts },
        "case import refused: nothing to import",
      );
      return res.status(400).json({ error: "IMPORT_NOTHING_TO_IMPORT" });
    }

    const parsedByExternalId = new Map(parsed.cases.map((c) => [c.externalId, c]));

    const result = await prisma.$transaction(
      async (tx) => {
        // 0. Serialise imports for this project.
        //
        //    The plan was computed outside the transaction, so without this two
        //    concurrent imports could both decide to CREATE the same suite or
        //    case and both succeed — there is no unique index on
        //    (projectId, parentId, name) to arbitrate, and adding one is a
        //    product decision (same-named sibling suites are legal today).
        //    A transaction-scoped advisory lock gives us the mutual exclusion
        //    without a schema change: it is taken per project, released
        //    automatically at commit or rollback, and leaves imports into other
        //    projects fully parallel. Every read below therefore happens while
        //    no other import can be mutating this project.
        //    `$executeRaw`, not `$queryRaw`: the function returns void, which
        //    Prisma cannot deserialize into a row.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IMPORT_LOCK_NAMESPACE}::int4, hashtext(${project.id}))`;

        // 1. Materialise missing suites root-first so parents exist before
        //    children. `suitesToCreate` is already in that order, and its Nth
        //    entry is exactly the `virtual:N` ref buildPlan handed out.
        const suiteIdByKey = new Map<string, string>();
        for (const s of await tx.testSuite.findMany({
          where: { projectId: project.id },
          select: { id: true, parentId: true, name: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })) {
          const key = suiteKey(s.parentId, s.name);
          if (!suiteIdByKey.has(key)) suiteIdByKey.set(key, s.id);
        }

        const refToId = new Map<string, string>();
        let suitesCreated = 0;
        for (const [index, path] of plan.suitesToCreate.entries()) {
          let parentId: string | null = null;
          for (let i = 0; i < path.length - 1; i++) {
            parentId = suiteIdByKey.get(suiteKey(parentId, path[i])) ?? null;
          }
          const name = path[path.length - 1];
          const key = suiteKey(parentId, name);
          // Another request may have created it between plan and commit —
          // reuse rather than creating a sibling with the same name.
          let id = suiteIdByKey.get(key);
          if (!id) {
            id = (
              await tx.testSuite.create({
                data: { projectId: project.id, parentId, name },
                select: { id: true },
              })
            ).id;
            suiteIdByKey.set(key, id);
            suitesCreated++;
          }
          refToId.set(`${VIRTUAL_PREFIX}${index}`, id);
        }

        const resolve = (ref: string) => (ref.startsWith(VIRTUAL_PREFIX) ? refToId.get(ref)! : ref);

        // 2. Create / update cases.
        //
        //    Re-resolve every decision against the catalogue as it exists under
        //    the lock. `plan` was built before the lock was held, so a case it
        //    marked CREATE may already exist (and one it marked UPDATE may have
        //    been deleted). This read is authoritative; the plan is only a
        //    proposal shown to the user.
        const liveCaseByKey = new Map<string, string>();
        for (const c of await tx.testCase.findMany({
          where: { suite: { projectId: project.id } },
          select: { id: true, suiteId: true, title: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })) {
          const key = caseKey(c.suiteId, c.title);
          if (!liveCaseByKey.has(key)) liveCaseByKey.set(key, c.id);
        }

        const created: string[] = [];
        const updated: string[] = [];
        let skipped = 0;

        for (const d of plan.decisions) {
          const source = parsedByExternalId.get(d.externalId)!;
          const suiteId = resolve(d.suiteRef);
          const key = caseKey(suiteId, source.title);
          const liveId = liveCaseByKey.get(key);

          // Recompute the action from live state rather than trusting the plan.
          const action: CaseDecision["action"] = liveId
            ? opts.duplicateStrategy === "UPDATE"
              ? "UPDATE"
              : "SKIP"
            : "CREATE";

          if (action === "SKIP") {
            skipped++;
            continue;
          }

          if (action === "CREATE") {
            const row = await tx.testCase.create({
              data: {
                suiteId,
                title: source.title,
                preconditions: source.preconditions,
                priority: source.priority,
                testLevel: source.testLevel,
                tags: source.tags,
                steps: source.steps as unknown as Prisma.InputJsonValue,
                estimatedMinutes: source.estimatedMinutes,
                requirements: source.requirements,
              },
              select: { id: true },
            });
            created.push(row.id);
            // Keep the index current so a later row can't create a twin.
            liveCaseByKey.set(key, row.id);
            continue;
          }

          // UPDATE — snapshot the current state into history first, exactly as
          // PATCH /api/cases/:id does, so the revision trail stays complete.
          const current = await tx.testCase.findUnique({ where: { id: liveId! } });
          if (!current) continue;
          const last = await tx.testCaseRevision.findFirst({
            where: { caseId: current.id },
            orderBy: { version: "desc" },
            select: { version: true },
          });
          await tx.testCaseRevision.create({
            data: {
              caseId: current.id,
              version: (last?.version ?? 0) + 1,
              title: current.title,
              description: current.description,
              preconditions: current.preconditions,
              postconditions: current.postconditions,
              parameters: current.parameters as Prisma.InputJsonValue,
              priority: current.priority,
              testLevel: current.testLevel,
              tags: current.tags,
              steps: current.steps as Prisma.InputJsonValue,
              estimatedMinutes: current.estimatedMinutes,
              requirements: current.requirements,
              customFieldValues: current.customFieldValues as Prisma.InputJsonValue,
              authorId: req.user!.id,
            },
          });
          await tx.testCase.update({
            where: { id: current.id },
            data: {
              title: source.title,
              preconditions: source.preconditions,
              priority: source.priority,
              testLevel: source.testLevel,
              tags: source.tags,
              steps: source.steps as unknown as Prisma.InputJsonValue,
              estimatedMinutes: source.estimatedMinutes,
              requirements: source.requirements,
            },
          });
          updated.push(current.id);
        }

        // 3. One bulk activity write rather than N round-trips.
        const entries = [
          ...created.map((id) => ({ id, action: "CASE_CREATED" as const })),
          ...updated.map((id) => ({ id, action: "CASE_UPDATED" as const })),
        ];
        if (entries.length > 0) {
          await tx.activityLog.createMany({
            data: entries.map((e) => ({
              projectId: project.id,
              userId: req.user!.id,
              action: e.action,
              entityType: "case",
              entityId: e.id,
              payload: { source: "excel-import" } as Prisma.InputJsonValue,
            })),
          });
        }

        return { created: created.length, updated: updated.length, skipped, suitesCreated };
      },
      { maxWait: 15_000, timeout: 120_000 },
    );

    req.log.info(
      {
        userId: req.user!.id,
        projectId: project.id,
        filename: req.file!.originalname,
        created: result.created,
        updated: result.updated,
        suitesCreated: result.suitesCreated,
        skipped: result.skipped,
        skippedInvalidRows: opts.skipInvalidRows ? plan.issues.length : 0,
        duplicateStrategy: opts.duplicateStrategy,
      },
      "case import committed",
    );

    res.status(201).json({
      message: "IMPORT_SUCCESS",
      projectId: project.id,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      suitesCreated: result.suitesCreated,
      issues: plan.issues,
    });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Qase JSON import / export
// ---------------------------------------------------------------------------

/** Read the uploaded Qase export and the target project, or fail with a machine key. */
async function prepareQase(req: AuthedRequest): Promise<{ projectId: string; plan: QasePlan }> {
  const { projectId } = z.object({ projectId: z.string().min(1) }).parse(req.body ?? {});
  const project = await prisma.project.findFirst({ where: projectWhere(req.user!, { id: projectId }), select: { id: true } });
  if (!project) throw httpError(404, "PROJECT_NOT_FOUND");
  const file = req.file;
  if (!file) throw httpError(400, "NO_FILE_UPLOADED");
  if (!/\.json$/i.test(file.originalname)) throw httpError(400, "IMPORT_QASE_INVALID");
  try {
    return { projectId: project.id, plan: parseQaseExport(JSON.parse(file.buffer.toString("utf8"))) };
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof QaseFormatError) {
      req.log.warn({ projectId: project.id, userId: req.user!.id, filename: file.originalname }, "qase import: not a Qase export");
      throw httpError(400, "IMPORT_QASE_INVALID");
    }
    throw e;
  }
}

/** Dry run: what importing this Qase export would create and update. Writes nothing. */
importsRouter.post("/qase/preview", requireManager, uploadSingle("file"), async (req: AuthedRequest, res, next) => {
  try {
    const { projectId, plan } = await prepareQase(req);
    const summary = await applyQaseImport(projectId, req.user!.id, plan, true);
    req.log.info({ projectId, userId: req.user!.id, suites: plan.suites.length, cases: plan.cases.length, summary }, "qase import previewed");
    res.json({ ...summary, suites: plan.suites.length, cases: plan.cases.length });
  } catch (e) {
    next(e);
  }
});

/** Import a Qase export; re-importing a newer export updates in place. */
importsRouter.post("/qase", requireManager, uploadSingle("file"), async (req: AuthedRequest, res, next) => {
  try {
    const { projectId, plan } = await prepareQase(req);
    const summary = await applyQaseImport(projectId, req.user!.id, plan, false);
    req.log.info({ projectId, userId: req.user!.id, suites: plan.suites.length, cases: plan.cases.length, summary }, "qase import committed");
    res.json({ ...summary, suites: plan.suites.length, cases: plan.cases.length });
  } catch (e) {
    next(e);
  }
});

/** Download the project's suites and cases as a Qase JSON export. */
importsRouter.get("/qase/export", async (req: AuthedRequest, res, next) => {
  try {
    const projectId = z.string().min(1).parse(req.query.projectId);
    const project = await prisma.project.findFirst({ where: projectWhere(req.user!, { id: projectId }), select: { id: true, key: true } });
    if (!project) throw httpError(404, "PROJECT_NOT_FOUND");
    const body = await exportQase(project.id);
    req.log.info({ projectId, userId: req.user!.id }, "qase export downloaded");
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Disposition", `attachment; filename="${project.key}-${date}.json"`);
    res.json(body);
  } catch (e) {
    next(e);
  }
});
