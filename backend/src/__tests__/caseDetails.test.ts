import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../db";
import { resetDb, disconnect } from "./helpers/db";
import { seedBaseline, createProject, createSuite, createCase, createUser } from "./helpers/factories";

beforeAll(async () => { await resetDb(); });
afterAll(async () => { await disconnect(); });
beforeEach(async () => { await resetDb(); });

const parameters = [
  { title: "Lang", values: ["English", "French"] },
  { title: "Expected", values: ["EN shown", "FR shown"] },
];
const stepsWithSubsteps = [
  { action: "Open Dope cards", expected: "List shown", substeps: [{ action: "Check the button", expected: "Send to pulse is visible" }] },
  { action: "Tap Send to pulse", expected: "Card sent" },
];

async function caseInProject(companyId: string) {
  const project = await createProject({ companyId });
  const suite = await createSuite({ projectId: project.id, name: "DOPE Cards" });
  const testCase = await createCase({ suiteId: suite.id, title: "Send a card" });
  return { project, suite, testCase };
}

describe("case description, post-conditions and parameters", () => {
  it("PATCH saves them and the revision keeps the previous values", async () => {
    const { manager, company } = await seedBaseline();
    const { testCase } = await caseInProject(company.id);

    const first = await request(app).patch(`/api/cases/${testCase.id}`).set("Authorization", `Bearer ${manager.token}`)
      .send({ description: "Spec link", postconditions: "Close the gallery", parameters });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ description: "Spec link", postconditions: "Close the gallery", parameters });

    await request(app).patch(`/api/cases/${testCase.id}`).set("Authorization", `Bearer ${manager.token}`)
      .send({ description: "New spec" });
    const latest = await prisma.testCaseRevision.findFirstOrThrow({ where: { caseId: testCase.id }, orderBy: { version: "desc" } });
    expect(latest).toMatchObject({ description: "Spec link", postconditions: "Close the gallery", parameters });
  });

  it("rejects a parameter without a title", async () => {
    const { manager, company } = await seedBaseline();
    const { testCase } = await caseInProject(company.id);

    const res = await request(app).patch(`/api/cases/${testCase.id}`).set("Authorization", `Bearer ${manager.token}`)
      .send({ parameters: [{ title: " ", values: ["a"] }] });

    expect(res.status).toBe(400);
  });
});

describe("substeps", () => {
  it("POST and GET keep substeps under their step", async () => {
    const { manager, company } = await seedBaseline();
    const { suite } = await caseInProject(company.id);

    const created = await request(app).post("/api/cases").set("Authorization", `Bearer ${manager.token}`)
      .send({ suiteId: suite.id, title: "With substeps", priority: "HIGH", steps: stepsWithSubsteps });
    expect(created.status).toBe(201);

    const got = await request(app).get(`/api/cases/${created.body.id}`).set("Authorization", `Bearer ${manager.token}`);
    expect(got.body.steps).toEqual(stepsWithSubsteps);
  });

  it("rejects a substep without an action", async () => {
    const { manager, company } = await seedBaseline();
    const { testCase } = await caseInProject(company.id);

    const res = await request(app).patch(`/api/cases/${testCase.id}`).set("Authorization", `Bearer ${manager.token}`)
      .send({ steps: [{ action: "Open", expected: "Opened", substeps: [{ action: "", expected: "x" }] }] });

    expect(res.status).toBe(400);
  });
});

describe("moving a case to another suite", () => {
  it("PATCH suiteId moves it within the project", async () => {
    const { manager, company } = await seedBaseline();
    const { project, testCase } = await caseInProject(company.id);
    const other = await createSuite({ projectId: project.id, name: "My guns" });

    const res = await request(app).patch(`/api/cases/${testCase.id}`).set("Authorization", `Bearer ${manager.token}`)
      .send({ suiteId: other.id });

    expect(res.status).toBe(200);
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } })).suiteId).toBe(other.id);
  });

  it("refuses a suite from another project", async () => {
    const { manager, company } = await seedBaseline();
    const { testCase, suite } = await caseInProject(company.id);
    const elsewhere = await caseInProject(company.id);

    const res = await request(app).patch(`/api/cases/${testCase.id}`).set("Authorization", `Bearer ${manager.token}`)
      .send({ suiteId: elsewhere.suite.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("CASE_INVALID_SUITE");
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: testCase.id } })).suiteId).toBe(suite.id);
  });
});

describe("GET /api/cases/:id/executions", () => {
  it("lists the case's executions across runs, newest run first, with run and Jira details", async () => {
    const { manager, company } = await seedBaseline();
    const { project, testCase } = await caseInProject(company.id);
    const executor = await createUser({ companyId: company.id, role: "TESTER", name: "Yevhen" });
    const older = await prisma.testRun.create({
      data: { projectId: project.id, name: "Smoke", createdById: manager.id, createdAt: new Date("2026-10-01T10:00:00Z") },
    });
    const newer = await prisma.testRun.create({
      data: { projectId: project.id, name: "Regression", createdById: manager.id, createdAt: new Date("2026-10-20T10:00:00Z") },
    });
    await prisma.testExecution.create({ data: { runId: older.id, caseId: testCase.id, status: "PASSED", executedById: executor.id } });
    await prisma.testExecution.create({
      data: { runId: newer.id, caseId: testCase.id, status: "FAILED", jiraIssueKey: "DM-12", jiraIssueUrl: "https://jira.example/DM-12" },
    });

    const res = await request(app).get(`/api/cases/${testCase.id}/executions`).set("Authorization", `Bearer ${manager.token}`);

    expect(res.status).toBe(200);
    expect(res.body.map((e: { run: { name: string } }) => e.run.name)).toEqual(["Regression", "Smoke"]);
    expect(res.body[0]).toMatchObject({ status: "FAILED", jiraIssueKey: "DM-12", run: { id: newer.id } });
    expect(res.body[1].executedBy).toMatchObject({ name: "Yevhen" });
  });

  it("is 404 for a case in another company", async () => {
    const { manager, otherCompany } = await seedBaseline();
    const { testCase } = await caseInProject(otherCompany.id);

    const res = await request(app).get(`/api/cases/${testCase.id}/executions`).set("Authorization", `Bearer ${manager.token}`);

    expect(res.status).toBe(404);
  });
});

describe("copies keep the new fields", () => {
  it("cloning a case copies description, post-conditions, parameters and substeps", async () => {
    const { manager, company } = await seedBaseline();
    const { testCase } = await caseInProject(company.id);
    await prisma.testCase.update({
      where: { id: testCase.id },
      data: { description: "D", postconditions: "P", parameters, steps: stepsWithSubsteps },
    });

    const res = await request(app).post(`/api/cases/${testCase.id}/clone`).set("Authorization", `Bearer ${manager.token}`).send({});

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ description: "D", postconditions: "P", parameters, steps: stepsWithSubsteps });
  });

  it("duplicating a suite copies them too", async () => {
    const { manager, company } = await seedBaseline();
    const { suite, testCase } = await caseInProject(company.id);
    await prisma.testCase.update({ where: { id: testCase.id }, data: { description: "D", postconditions: "P", parameters } });

    const res = await request(app).post(`/api/suites/${suite.id}/duplicate`).set("Authorization", `Bearer ${manager.token}`).send({});

    const copy = await prisma.testCase.findFirstOrThrow({ where: { suiteId: res.body.id } });
    expect(copy).toMatchObject({ description: "D", postconditions: "P", parameters });
  });
});
