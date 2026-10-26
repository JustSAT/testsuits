import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import ExcelJS from "exceljs";
import { deflateRawSync } from "zlib";
import { app } from "../app";
import { prisma } from "../db";
import { resetDb, disconnect } from "./helpers/db";
import { seedBaseline, createProject, createSuite, createCase } from "./helpers/factories";
import { CASES_SHEET, STEPS_SHEET, LIMITS } from "../lib/excelCases";

beforeAll(async () => { await resetDb(); });
afterAll(async () => { await disconnect(); });
beforeEach(async () => { await resetDb(); });

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const CASE_HEADER = [
  "Case ID", "Suite Path", "Title", "Priority", "Test Level",
  "Preconditions", "Tags", "Estimated Minutes", "Requirements",
];
const STEP_HEADER = ["Case ID", "Step", "Action", "Expected Result"];

type Rows = Array<Array<string | number | null>>;

async function xlsx(sheets: Record<string, Rows>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = wb.addWorksheet(name);
    rows.forEach((r) => sheet.addRow(r));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Two cases under nested suites, the first with two steps. */
async function sampleWorkbook() {
  return xlsx({
    [CASES_SHEET]: [
      CASE_HEADER,
      ["TC-1", "LMS > Assignments", "Start assessment from a card", "HIGH", "SMOKE", "Signed in", "lms, smoke", 5, "REQ-1"],
      ["TC-2", "LMS > Skills", "My level indicator is accurate", "", "", "", "", "", ""],
    ],
    [STEPS_SHEET]: [
      STEP_HEADER,
      ["TC-1", 1, "Open My Assignments", "The list is shown"],
      ["TC-1", 2, "Click Start assessment", "The flow opens"],
    ],
  });
}

function post(path: string, token: string) {
  return request(app).post(path).set("Authorization", `Bearer ${token}`);
}

/**
 * superagent has no parser for the xlsx content type, so `res.body` would come
 * back as an empty object. `responseType("blob")` makes it buffer the raw bytes
 * into a Buffer instead.
 */
function getTemplate(token: string) {
  return request(app)
    .get("/api/imports/cases/template.xlsx")
    .set("Authorization", `Bearer ${token}`)
    .responseType("blob");
}

describe("GET /api/imports/cases/template.xlsx", () => {
  it("returns an xlsx workbook to a manager", async () => {
    const { manager } = await seedBaseline();
    const res = await getTemplate(manager.token);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(res.headers["content-disposition"]).toContain("suitesglobal-case-import-template.xlsx");
    // xlsx is a zip — check the magic bytes rather than trusting the header.
    expect(res.body.subarray(0, 2).toString()).toBe("PK");
  });

  it("rejects a tester (MANAGER_ROLE_REQUIRED)", async () => {
    const { tester } = await seedBaseline();
    const res = await request(app)
      .get("/api/imports/cases/template.xlsx")
      .set("Authorization", `Bearer ${tester.token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MANAGER_ROLE_REQUIRED");
  });

  it("rejects an unauthenticated caller", async () => {
    const res = await request(app).get("/api/imports/cases/template.xlsx");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/imports/cases/preview", () => {
  it("reports what would happen and writes nothing", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const res = await post("/api/imports/cases/preview", manager.token)
      .field("projectId", project.id)
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ create: 2, update: 0, skip: 0, suites: 3, steps: 2 });
    expect(res.body.issues).toEqual([]);
    expect(res.body.suitesToCreate).toEqual(["LMS", "LMS > Assignments", "LMS > Skills"]);
    expect(res.body.decisions).toHaveLength(2);
    expect(res.body.decisions[0]).toMatchObject({ action: "CREATE", stepCount: 2, row: 2 });

    // Nothing persisted.
    expect(await prisma.testSuite.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.testCase.count()).toBe(0);
  });

  it("surfaces row-level problems with their sheet and row number", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const file = await xlsx({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "fine", "", "", "", "", "", ""],
        ["TC-2", "LMS", "bad priority", "URGENT", "", "", "", "", ""],
      ],
    });

    const res = await post("/api/imports/cases/preview", manager.token)
      .field("projectId", project.id)
      .attach("file", file, { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(200);
    expect(res.body.counts.create).toBe(1);
    expect(res.body.issues).toEqual([
      { sheet: CASES_SHEET, row: 3, code: "IMPORT_PRIORITY_INVALID", column: "Priority", value: "URGENT" },
    ]);
  });

  it("marks an existing case as SKIP or UPDATE per the chosen strategy", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const lms = await createSuite({ projectId: project.id, name: "LMS" });
    const assignments = await createSuite({ projectId: project.id, name: "Assignments", parentId: lms.id });
    await createCase({ suiteId: assignments.id, title: "Start assessment from a card" });

    const skip = await post("/api/imports/cases/preview", manager.token)
      .field("projectId", project.id)
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });
    expect(skip.body.counts).toMatchObject({ create: 1, update: 0, skip: 1, suites: 1 });

    const update = await post("/api/imports/cases/preview", manager.token)
      .field("projectId", project.id)
      .field("duplicateStrategy", "UPDATE")
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });
    expect(update.body.counts).toMatchObject({ create: 1, update: 1, skip: 0 });
  });

  it("404s for a project in another company", async () => {
    const { otherManager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const res = await post("/api/imports/cases/preview", otherManager.token)
      .field("projectId", project.id)
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("PROJECT_NOT_FOUND");
  });

  it("rejects a non-xlsx upload", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const res = await post("/api/imports/cases/preview", manager.token)
      .field("projectId", project.id)
      .attach("file", Buffer.from("a,b,c"), { filename: "cases.csv", contentType: "text/csv" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("IMPORT_INVALID_FILE_TYPE");
  });

  it("rejects an .xlsx that isn't a real workbook", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const res = await post("/api/imports/cases/preview", manager.token)
      .field("projectId", project.id)
      .attach("file", Buffer.from("not really a workbook"), { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("IMPORT_FILE_UNREADABLE");
  });

  it("rejects a workbook that would inflate past the archive limit", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    // A real zip bomb: small on the wire, genuinely inflates past the cap, and
    // its headers understate the payload as a single byte. The guard measures
    // what actually comes out rather than believing the declaration.
    const name = Buffer.from("xl/worksheets/sheet1.xml", "utf8");
    const payload = deflateRawSync(Buffer.alloc(LIMITS.maxUncompressedBytes + 4 * 1024 * 1024, 0x41), {
      level: 9,
    });
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(1, 22); // understated on purpose
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(1, 24); // understated on purpose
    central.writeUInt16LE(name.length, 28);
    name.copy(central, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(local.length + payload.length, 16);
    const bomb = Buffer.concat([local, payload, central, eocd]);
    expect(bomb.length).toBeLessThan(1024 * 1024); // tiny upload, huge inflate

    const res = await post("/api/imports/cases/preview", manager.token)
      .field("projectId", project.id)
      .attach("file", bomb, { filename: "bomb.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("IMPORT_ARCHIVE_TOO_LARGE");
  });

  it("rejects both rows of a duplicated Case ID and refuses to guess its steps", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const file = await xlsx({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "first", "", "", "", "", "", ""],
        ["TC-1", "LMS", "second", "", "", "", "", "", ""],
      ],
      [STEPS_SHEET]: [STEP_HEADER, ["TC-1", 1, "ambiguous step", "unclear"]],
    });

    const res = await post("/api/imports/cases/preview", manager.token)
      .field("projectId", project.id)
      .attach("file", file, { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(200);
    expect(res.body.counts.create).toBe(0);
    expect(res.body.issues.map((i: { code: string }) => i.code)).toEqual([
      "IMPORT_CASE_ID_DUPLICATE",
      "IMPORT_CASE_ID_DUPLICATE",
      "IMPORT_STEP_AMBIGUOUS_CASE_ID",
    ]);
  });

  it("will not commit steps from an ambiguous Case ID even with skipInvalidRows", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const file = await xlsx({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "first", "", "", "", "", "", ""],
        ["TC-1", "LMS", "second", "", "", "", "", "", ""],
        ["TC-2", "LMS", "unambiguous", "", "", "", "", "", ""],
      ],
      [STEPS_SHEET]: [
        STEP_HEADER,
        ["TC-1", 1, "must not land anywhere", "nope"],
        ["TC-2", 1, "legitimate step", "fine"],
      ],
    });

    const res = await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .field("skipInvalidRows", "true")
      .attach("file", file, { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);

    const cases = await prisma.testCase.findMany();
    expect(cases.map((c) => c.title)).toEqual(["unambiguous"]);
    expect(cases[0].steps).toEqual([{ action: "legitimate step", expected: "fine" }]);
  });

  it("rejects a request with no file", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const res = await post("/api/imports/cases/preview", manager.token).field("projectId", project.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("NO_FILE_UPLOADED");
  });
});

describe("POST /api/imports/cases", () => {
  it("creates the nested suites, cases, and steps in one go", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const res = await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ message: "IMPORT_SUCCESS", created: 2, updated: 0, suitesCreated: 3 });

    const suites = await prisma.testSuite.findMany({ where: { projectId: project.id } });
    expect(suites).toHaveLength(3);
    const root = suites.find((s) => s.name === "LMS")!;
    expect(root.parentId).toBeNull();
    expect(suites.filter((s) => s.parentId === root.id).map((s) => s.name).sort()).toEqual([
      "Assignments",
      "Skills",
    ]);

    const created = await prisma.testCase.findFirst({ where: { title: "Start assessment from a card" } });
    expect(created).toMatchObject({
      priority: "HIGH",
      testLevel: "SMOKE",
      preconditions: "Signed in",
      estimatedMinutes: 5,
    });
    expect(created!.tags).toEqual(["lms", "smoke"]);
    expect(created!.requirements).toEqual(["REQ-1"]);
    expect(created!.steps).toEqual([
      { action: "Open My Assignments", expected: "The list is shown" },
      { action: "Click Start assessment", expected: "The flow opens" },
    ]);

    // Defaults applied to the sparse second row.
    const second = await prisma.testCase.findFirst({ where: { title: "My level indicator is accurate" } });
    expect(second).toMatchObject({ priority: "MEDIUM", testLevel: "REGRESSION", preconditions: null });
    expect(second!.steps).toEqual([]);
  });

  it("writes one activity entry per imported case", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });

    const logs = await prisma.activityLog.findMany({ where: { projectId: project.id } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.action === "CASE_CREATED")).toBe(true);
    expect(logs.every((l) => l.userId === manager.id)).toBe(true);
    expect(logs[0].payload).toEqual({ source: "excel-import" });
  });

  it("reuses an existing suite instead of creating a duplicate", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const lms = await createSuite({ projectId: project.id, name: "LMS" });

    const res = await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(201);
    expect(res.body.suitesCreated).toBe(2);
    const roots = await prisma.testSuite.findMany({ where: { projectId: project.id, parentId: null } });
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe(lms.id);
  });

  it("skips an existing case by default and leaves it untouched", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const lms = await createSuite({ projectId: project.id, name: "LMS" });
    const assignments = await createSuite({ projectId: project.id, name: "Assignments", parentId: lms.id });
    const existing = await createCase({
      suiteId: assignments.id,
      title: "Start assessment from a card",
      priority: "LOW",
    });

    const res = await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 1, updated: 0, skipped: 1 });

    const after = await prisma.testCase.findUnique({ where: { id: existing.id } });
    expect(after!.priority).toBe("LOW");
    expect(await prisma.testCaseRevision.count()).toBe(0);
  });

  it("updates an existing case and snapshots a revision when asked to", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const lms = await createSuite({ projectId: project.id, name: "LMS" });
    const assignments = await createSuite({ projectId: project.id, name: "Assignments", parentId: lms.id });
    const existing = await createCase({
      suiteId: assignments.id,
      title: "Start assessment from a card",
      priority: "LOW",
      steps: [{ action: "old", expected: "old" }],
    });

    const res = await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .field("duplicateStrategy", "UPDATE")
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ created: 1, updated: 1, skipped: 0 });

    const after = await prisma.testCase.findUnique({ where: { id: existing.id } });
    expect(after!.priority).toBe("HIGH");
    expect(after!.steps).toEqual([
      { action: "Open My Assignments", expected: "The list is shown" },
      { action: "Click Start assessment", expected: "The flow opens" },
    ]);

    const revisions = await prisma.testCaseRevision.findMany({ where: { caseId: existing.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ version: 1, priority: "LOW", authorId: manager.id });
    expect(revisions[0].steps).toEqual([{ action: "old", expected: "old" }]);
  });

  it("refuses a file with row errors and writes nothing", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const file = await xlsx({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "fine", "", "", "", "", "", ""],
        ["TC-2", "LMS", "bad", "URGENT", "", "", "", "", ""],
      ],
    });

    const res = await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .attach("file", file, { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("IMPORT_HAS_ERRORS");
    expect(res.body.issues).toHaveLength(1);
    expect(await prisma.testCase.count()).toBe(0);
    expect(await prisma.testSuite.count()).toBe(0);
  });

  it("imports the good rows when skipInvalidRows is set", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const file = await xlsx({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "fine", "", "", "", "", "", ""],
        ["TC-2", "LMS", "bad", "URGENT", "", "", "", "", ""],
      ],
    });

    const res = await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .field("skipInvalidRows", "true")
      .attach("file", file, { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(1);
    expect(res.body.issues).toHaveLength(1);
    const cases = await prisma.testCase.findMany();
    expect(cases.map((c) => c.title)).toEqual(["fine"]);
  });

  it("refuses when every row is a duplicate", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const suite = await createSuite({ projectId: project.id, name: "LMS" });
    await createCase({ suiteId: suite.id, title: "only one" });
    const file = await xlsx({
      [CASES_SHEET]: [CASE_HEADER, ["TC-1", "LMS", "only one", "", "", "", "", "", ""]],
    });

    const res = await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .attach("file", file, { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("IMPORT_NOTHING_TO_IMPORT");
  });

  it("flags two rows that resolve to the same suite and title", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const file = await xlsx({
      [CASES_SHEET]: [
        CASE_HEADER,
        ["TC-1", "LMS", "same title", "", "", "", "", "", ""],
        ["TC-2", "LMS", "Same Title", "", "", "", "", "", ""],
      ],
    });

    const res = await post("/api/imports/cases/preview", manager.token)
      .field("projectId", project.id)
      .attach("file", file, { filename: "cases.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(200);
    expect(res.body.counts.create).toBe(1);
    expect(res.body.issues).toEqual([
      { sheet: CASES_SHEET, row: 3, code: "IMPORT_DUPLICATE_IN_FILE", value: "Same Title" },
    ]);
  });

  it("does not create duplicates when the same file is imported concurrently", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    // Both requests plan against an empty project, so both plans say CREATE for
    // every row and every suite. The per-project advisory lock plus the
    // in-transaction re-resolution must collapse the second one into skips.
    const [a, b] = await Promise.all([
      post("/api/imports/cases", manager.token)
        .field("projectId", project.id)
        .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME }),
      post("/api/imports/cases", manager.token)
        .field("projectId", project.id)
        .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME }),
    ]);

    // One import does the work; the other finds everything already there. It
    // may 201 with zero creates or 400 IMPORT_NOTHING_TO_IMPORT depending on
    // which side of the lock it lands — both are correct outcomes.
    expect([a.status, b.status].every((s) => s === 201 || s === 400)).toBe(true);
    expect(a.status === 201 || b.status === 201).toBe(true);

    const suites = await prisma.testSuite.findMany({ where: { projectId: project.id } });
    expect(suites).toHaveLength(3);
    expect(suites.filter((s) => s.name === "LMS")).toHaveLength(1);

    const cases = await prisma.testCase.findMany({ where: { suite: { projectId: project.id } } });
    expect(cases).toHaveLength(2);
    expect(new Set(cases.map((c) => c.title)).size).toBe(2);

    const totalCreated = (a.body.created ?? 0) + (b.body.created ?? 0);
    expect(totalCreated).toBe(2);
  });

  it("rejects a tester", async () => {
    const { tester, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const res = await post("/api/imports/cases", tester.token)
      .field("projectId", project.id)
      .attach("file", await sampleWorkbook(), { filename: "cases.xlsx", contentType: XLSX_MIME });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MANAGER_ROLE_REQUIRED");
  });

  it("round-trips the downloadable template", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const template = await getTemplate(manager.token);

    const res = await post("/api/imports/cases", manager.token)
      .field("projectId", project.id)
      .attach("file", template.body, { filename: "template.xlsx", contentType: XLSX_MIME });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(2);
    const cases = await prisma.testCase.findMany({ orderBy: { title: "asc" } });
    expect(cases).toHaveLength(2);
    expect((cases[0].steps as unknown[]).length).toBe(2);
  });
});
