import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../db";
import { resetDb, disconnect } from "./helpers/db";
import { seedBaseline, createProject, createSuite, createCase } from "./helpers/factories";

beforeAll(async () => { await resetDb(); });
afterAll(async () => { await disconnect(); });
beforeEach(async () => { await resetDb(); });

const step = (action: string, expected = "Done") => ({ position: 1, action, expected_result: expected, data: "", steps: [] });
const qcase = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id, title, description: null, preconditions: "Signed in", postconditions: null, priority: "medium", severity: "normal",
  type: "functional", behavior: "positive", layer: "e2e", custom_fields: [], steps: [step("Open")], tags: [], params: [], ...extra,
});
const exportFile = (cases = [qcase(501, "Sign in"), qcase(502, "Sign up")]) => ({
  cases: [],
  suites: [{ id: 10, title: "Auth", description: null, suites: [{ id: 11, title: "Email", description: "Email flows", suites: [], cases }], cases: [] }],
});

function upload(path: string, token: string, projectId: string, body: unknown) {
  return request(app).post(path).set("Authorization", `Bearer ${token}`)
    .field("projectId", projectId)
    .attach("file", Buffer.from(JSON.stringify(body)), { filename: "DM.json", contentType: "application/json" });
}

describe("Qase JSON import", () => {
  it("preview reports what an import would create and writes nothing", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const res = await upload("/api/imports/qase/preview", manager.token, project.id, exportFile());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ suitesCreated: 2, casesCreated: 2, casesUpdated: 0, casesUnchanged: 0 });
    expect(await prisma.testCase.count()).toBe(0);
  });

  it("creates the suite tree and cases with every mapped field", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const res = await upload("/api/imports/qase", manager.token, project.id, exportFile([
      qcase(501, "Sign in", {
        priority: "high", description: "Spec", postconditions: "Sign out", params: [{ title: "Lang", values: ["en", "fr"] }],
        steps: [{ ...step("Open"), steps: [{ position: 1, action: "Check", expected_result: "", data: "x", steps: [] }] }],
      }),
    ]));

    expect(res.status).toBe(200);
    const email = await prisma.testSuite.findFirstOrThrow({ where: { projectId: project.id, name: "Email" }, include: { parent: true } });
    expect(email).toMatchObject({ externalRef: "11", description: "Email flows", parent: { name: "Auth", externalRef: "10" } });
    const c = await prisma.testCase.findFirstOrThrow({ where: { suiteId: email.id } });
    expect(c).toMatchObject({
      externalRef: "501", title: "Sign in", description: "Spec", preconditions: "Signed in", postconditions: "Sign out", priority: "HIGH",
      parameters: [{ title: "Lang", values: ["en", "fr"] }],
      steps: [{ action: "Open", expected: "Done", substeps: [{ action: "Check", data: "x" }] }],
    });
    expect(c.tags).toEqual(["severity:normal", "type:functional", "behavior:positive", "layer:e2e"]);
  });

  it("re-importing the same export changes nothing", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    // Input data on a step: Postgres stores JSON keys in its own order.
    const withData = () => exportFile([qcase(501, "Sign in", { steps: [{ ...step("Open"), data: "user@example.com" }] }), qcase(502, "Sign up")]);
    await upload("/api/imports/qase", manager.token, project.id, withData());

    const res = await upload("/api/imports/qase", manager.token, project.id, withData());

    expect(res.body).toMatchObject({ suitesCreated: 0, suitesUpdated: 0, casesCreated: 0, casesUpdated: 0, casesUnchanged: 2 });
    expect(await prisma.testCase.count()).toBe(2);
    expect(await prisma.testCaseRevision.count()).toBe(0);
  });

  it("a newer export updates the changed case and keeps its history", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    await upload("/api/imports/qase", manager.token, project.id, exportFile());

    const res = await upload("/api/imports/qase", manager.token, project.id, exportFile([qcase(501, "Sign in by e-mail"), qcase(502, "Sign up")]));

    expect(res.body).toMatchObject({ casesCreated: 0, casesUpdated: 1, casesUnchanged: 1 });
    const c = await prisma.testCase.findFirstOrThrow({ where: { externalRef: "501" } });
    expect(c.title).toBe("Sign in by e-mail");
    expect(await prisma.testCaseRevision.findFirst({ where: { caseId: c.id } })).toMatchObject({ title: "Sign in" });
  });

  it("matches cases imported earlier without a Qase id by suite path and title", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const auth = await createSuite({ projectId: project.id, name: "Auth" });
    const email = await createSuite({ projectId: project.id, name: "Email", parentId: auth.id });
    const old = await createCase({ suiteId: email.id, title: "Sign in" });

    const res = await upload("/api/imports/qase", manager.token, project.id, exportFile());

    expect(res.body).toMatchObject({ suitesCreated: 0, casesCreated: 1, casesUpdated: 1 });
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ externalRef: "501", preconditions: "Signed in" });
    expect(await prisma.testSuite.count({ where: { projectId: project.id } })).toBe(2);
  });

  it("keeps a Critical priority that Qase can only call high", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    await upload("/api/imports/qase", manager.token, project.id, exportFile([qcase(501, "Sign in", { priority: "high" })]));
    await prisma.testCase.updateMany({ where: { externalRef: "501" }, data: { priority: "CRITICAL" } });

    const res = await upload("/api/imports/qase", manager.token, project.id, exportFile([qcase(501, "Sign in", { priority: "high" })]));

    expect(res.body).toMatchObject({ casesUpdated: 0, casesUnchanged: 1 });
    expect((await prisma.testCase.findFirstOrThrow({ where: { externalRef: "501" } })).priority).toBe("CRITICAL");
  });

  it("rejects a file that is not a Qase export", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const res = await upload("/api/imports/qase/preview", manager.token, project.id, { hello: "world" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("IMPORT_QASE_INVALID");
  });

  it("is manager-only and tenant-scoped", async () => {
    const { tester, manager, otherCompany } = await seedBaseline();
    const theirs = await createProject({ companyId: otherCompany.id });

    expect((await upload("/api/imports/qase", tester.token, theirs.id, exportFile())).status).toBe(403);
    expect((await upload("/api/imports/qase", manager.token, theirs.id, exportFile())).status).toBe(404);
  });
});

describe("Qase JSON export", () => {
  it("exports the project so that importing it again changes nothing", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    await upload("/api/imports/qase", manager.token, project.id, exportFile());
    const local = await createSuite({ projectId: project.id, name: "Made here" });
    await createCase({ suiteId: local.id, title: "Local case" });

    const res = await request(app).get("/api/imports/qase/export").query({ projectId: project.id }).set("Authorization", `Bearer ${manager.token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain(".json");
    const auth = res.body.suites.find((s: { title: string }) => s.title === "Auth");
    expect(auth).toMatchObject({ id: 10, suites: [{ id: 11, title: "Email" }] });
    expect(auth.suites[0].cases.map((c: { id: number }) => c.id)).toEqual([501, 502]);
    const made = res.body.suites.find((s: { title: string }) => s.title === "Made here");
    expect(made.id).toBeGreaterThan(502);

    const again = await upload("/api/imports/qase", manager.token, project.id, res.body);
    expect(again.body).toMatchObject({ suitesCreated: 0, casesCreated: 0, casesUpdated: 0 });
  });

  it("is 404 for a project in another company", async () => {
    const { manager, otherCompany } = await seedBaseline();
    const theirs = await createProject({ companyId: otherCompany.id });

    const res = await request(app).get("/api/imports/qase/export").query({ projectId: theirs.id }).set("Authorization", `Bearer ${manager.token}`);

    expect(res.status).toBe(404);
  });
});
