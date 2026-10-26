import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../db";
import { resetDb, disconnect } from "./helpers/db";
import { seedBaseline, createProject, createSuite, createCase } from "./helpers/factories";

beforeAll(async () => { await resetDb(); });
afterAll(async () => { await disconnect(); });
beforeEach(async () => { await resetDb(); });

// Root "Gallery" holds no case itself; its cases live two levels down:
//   Gallery
//   ├── Shotisize (2 cases)
//   │   └── Localization (1 case)
//   └── Filters (1 case)
async function nestedProject(companyId: string) {
  const project = await createProject({ companyId });
  const gallery = await createSuite({ projectId: project.id, name: "Gallery" });
  const shotisize = await createSuite({ projectId: project.id, name: "Shotisize", parentId: gallery.id });
  const localization = await createSuite({ projectId: project.id, name: "Localization", parentId: shotisize.id });
  const filters = await createSuite({ projectId: project.id, name: "Filters", parentId: gallery.id });
  const c1 = await createCase({ suiteId: shotisize.id, title: "Shots open", testLevel: "SMOKE" });
  const c2 = await createCase({ suiteId: shotisize.id, title: "Shots play" });
  const c3 = await createCase({ suiteId: localization.id, title: "French labels" });
  const c4 = await createCase({ suiteId: filters.id, title: "Filter by date", testLevel: "SMOKE" });
  return { project, gallery, shotisize, localization, filters, cases: [c1, c2, c3, c4] };
}

describe("suite case totals", () => {
  it("GET /api/projects/:id counts every case under a root suite, at any depth", async () => {
    const { manager, company } = await seedBaseline();
    const { project } = await nestedProject(company.id);

    const res = await request(app).get(`/api/projects/${project.id}`).set("Authorization", `Bearer ${manager.token}`);

    expect(res.status).toBe(200);
    expect(res.body.suites).toHaveLength(1);
    expect(res.body.suites[0].name).toBe("Gallery");
    expect(res.body.suites[0].totalCases).toBe(4);
  });

  it("GET /api/suites/:id counts the suite's own subtree and each child's", async () => {
    const { manager, company } = await seedBaseline();
    const { gallery } = await nestedProject(company.id);

    const res = await request(app).get(`/api/suites/${gallery.id}`).set("Authorization", `Bearer ${manager.token}`);

    expect(res.status).toBe(200);
    expect(res.body.totalCases).toBe(4);
    const byName = Object.fromEntries(res.body.children.map((c: { name: string; totalCases: number }) => [c.name, c.totalCases]));
    expect(byName).toEqual({ Shotisize: 3, Filters: 1 });
  });
});

describe("GET /api/projects/:id/case-tree", () => {
  it("returns every suite and case of the project for the case picker", async () => {
    const { tester, company } = await seedBaseline();
    const { project, gallery, shotisize, cases } = await nestedProject(company.id);

    const res = await request(app).get(`/api/projects/${project.id}/case-tree`).set("Authorization", `Bearer ${tester.token}`);

    expect(res.status).toBe(200);
    expect(res.body.suites).toHaveLength(4);
    expect(res.body.suites).toContainEqual({ id: shotisize.id, parentId: gallery.id, name: "Shotisize" });
    expect(res.body.cases).toHaveLength(4);
    expect(res.body.cases[0]).toEqual({
      id: cases[0].id,
      suiteId: shotisize.id,
      title: "Shots open",
      priority: "MEDIUM",
      testLevel: "SMOKE",
    });
  });

  it("is 404 for a project in another company", async () => {
    const { manager, otherCompany } = await seedBaseline();
    const { project } = await nestedProject(otherCompany.id);

    const res = await request(app).get(`/api/projects/${project.id}/case-tree`).set("Authorization", `Bearer ${manager.token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("PROJECT_NOT_FOUND");
  });
});

describe("POST /api/runs case selection", () => {
  const base = { name: "Run", environment: "dev" };

  async function runCaseIds(runId: string) {
    const ex = await prisma.testExecution.findMany({ where: { runId }, select: { caseId: true } });
    return ex.map((e) => e.caseId).sort();
  }

  it("a selected suite brings the cases of all its sub-suites", async () => {
    const { manager, company } = await seedBaseline();
    const { project, gallery, cases } = await nestedProject(company.id);

    const res = await request(app).post("/api/runs").set("Authorization", `Bearer ${manager.token}`)
      .send({ ...base, projectId: project.id, suiteIds: [gallery.id] });

    expect(res.status).toBe(201);
    expect(await runCaseIds(res.body.id)).toEqual(cases.map((c) => c.id).sort());
  });

  it("creates a run from individually picked cases", async () => {
    const { manager, company } = await seedBaseline();
    const { project, cases } = await nestedProject(company.id);

    const res = await request(app).post("/api/runs").set("Authorization", `Bearer ${manager.token}`)
      .send({ ...base, projectId: project.id, caseIds: [cases[1].id, cases[2].id] });

    expect(res.status).toBe(201);
    expect(await runCaseIds(res.body.id)).toEqual([cases[1].id, cases[2].id].sort());
  });

  it("rejects case ids that are not in the run's project", async () => {
    const { manager, company, otherCompany } = await seedBaseline();
    const { project, cases } = await nestedProject(company.id);
    const otherProject = await nestedProject(company.id);
    const foreign = await nestedProject(otherCompany.id);

    for (const stranger of [otherProject.cases[0].id, foreign.cases[0].id]) {
      const res = await request(app).post("/api/runs").set("Authorization", `Bearer ${manager.token}`)
        .send({ ...base, projectId: project.id, caseIds: [cases[0].id, stranger] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("RUN_CASES_NOT_IN_PROJECT");
    }
    expect(await prisma.testRun.count()).toBe(0);
  });

  it("rejects suite ids that are not in the run's project", async () => {
    const { manager, company } = await seedBaseline();
    const { project } = await nestedProject(company.id);
    const otherProject = await nestedProject(company.id);

    const res = await request(app).post("/api/runs").set("Authorization", `Bearer ${manager.token}`)
      .send({ ...base, projectId: project.id, suiteIds: [otherProject.gallery.id] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("RUN_SUITES_NOT_IN_PROJECT");
  });

  it("the level filter narrows picked cases as well as suites", async () => {
    const { manager, company } = await seedBaseline();
    const { project, cases } = await nestedProject(company.id);

    const res = await request(app).post("/api/runs").set("Authorization", `Bearer ${manager.token}`)
      .send({ ...base, projectId: project.id, caseIds: cases.map((c) => c.id), testLevels: ["SMOKE"] });

    expect(res.status).toBe(201);
    expect(await runCaseIds(res.body.id)).toEqual([cases[0].id, cases[3].id].sort());
  });
});
