import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../db";
import { resetDb, disconnect } from "./helpers/db";
import { seedBaseline, createProject, createSuite, createCase } from "./helpers/factories";

beforeAll(async () => { await resetDb(); });
afterAll(async () => { await disconnect(); });
beforeEach(async () => { await resetDb(); });

const prod = { title: "Production", slug: "prod", description: "Live app", type: "STATIC", host: "https://app.example.com" };

describe("project environments", () => {
  it("a manager creates one and everyone in the company lists it with its run count", async () => {
    const { manager, tester, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const created = await request(app).post("/api/environments").set("Authorization", `Bearer ${manager.token}`)
      .send({ projectId: project.id, ...prod });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ...prod, projectId: project.id });

    const list = await request(app).get("/api/environments").query({ projectId: project.id }).set("Authorization", `Bearer ${tester.token}`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([expect.objectContaining({ title: "Production", runCount: 0, lastRunAt: null })]);
  });

  it("keeps slugs unique within a project", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const other = await createProject({ companyId: company.id });
    await request(app).post("/api/environments").set("Authorization", `Bearer ${manager.token}`).send({ projectId: project.id, ...prod });

    const dup = await request(app).post("/api/environments").set("Authorization", `Bearer ${manager.token}`).send({ projectId: project.id, ...prod, title: "Prod 2" });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("ENVIRONMENT_SLUG_TAKEN");

    const elsewhere = await request(app).post("/api/environments").set("Authorization", `Bearer ${manager.token}`).send({ projectId: other.id, ...prod });
    expect(elsewhere.status).toBe(201);
  });

  it("rejects a slug that is not lowercase letters, digits and dashes", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });

    const res = await request(app).post("/api/environments").set("Authorization", `Bearer ${manager.token}`).send({ projectId: project.id, ...prod, slug: "Prod Env" });

    expect(res.status).toBe(400);
  });

  it("updates and deletes; a deleted environment leaves its runs with the name", async () => {
    const { manager, company } = await seedBaseline();
    const project = await createProject({ companyId: company.id });
    const env = (await request(app).post("/api/environments").set("Authorization", `Bearer ${manager.token}`).send({ projectId: project.id, ...prod })).body;
    const run = await prisma.testRun.create({ data: { projectId: project.id, name: "Smoke", createdById: manager.id, environmentId: env.id, environment: "Production" } });

    const patched = await request(app).patch(`/api/environments/${env.id}`).set("Authorization", `Bearer ${manager.token}`).send({ type: "DYNAMIC", host: "*.feature.example.com" });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ type: "DYNAMIC", host: "*.feature.example.com", title: "Production" });

    const del = await request(app).delete(`/api/environments/${env.id}`).set("Authorization", `Bearer ${manager.token}`);
    expect(del.status).toBe(204);
    expect(await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ environmentId: null, environment: "Production" });
  });

  it("is manager-only to change and tenant-scoped", async () => {
    const { manager, tester, otherCompany } = await seedBaseline();
    const theirs = await createProject({ companyId: otherCompany.id });

    expect((await request(app).post("/api/environments").set("Authorization", `Bearer ${tester.token}`).send({ projectId: theirs.id, ...prod })).status).toBe(403);
    expect((await request(app).post("/api/environments").set("Authorization", `Bearer ${manager.token}`).send({ projectId: theirs.id, ...prod })).status).toBe(404);
    expect((await request(app).get("/api/environments").query({ projectId: theirs.id }).set("Authorization", `Bearer ${manager.token}`)).status).toBe(404);
  });
});

describe("runs on an environment", () => {
  async function setup() {
    const base = await seedBaseline();
    const project = await createProject({ companyId: base.company.id });
    const suite = await createSuite({ projectId: project.id });
    const testCase = await createCase({ suiteId: suite.id });
    const env = await prisma.environment.create({ data: { projectId: project.id, ...prod, type: "STATIC" } });
    return { ...base, project, testCase, env };
  }

  it("a run picks a project environment and records its title", async () => {
    const { manager, project, testCase, env } = await setup();

    const res = await request(app).post("/api/runs").set("Authorization", `Bearer ${manager.token}`)
      .send({ projectId: project.id, name: "Smoke", environmentId: env.id, caseIds: [testCase.id] });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ environmentId: env.id, environment: "Production" });
  });

  it("a run may have no environment", async () => {
    const { manager, project, testCase } = await setup();

    const res = await request(app).post("/api/runs").set("Authorization", `Bearer ${manager.token}`)
      .send({ projectId: project.id, name: "Smoke", caseIds: [testCase.id] });

    expect(res.status).toBe(201);
    expect(res.body.environmentId).toBeNull();
  });

  it("refuses an environment of another project", async () => {
    const { manager, company, project, testCase } = await setup();
    const other = await createProject({ companyId: company.id });
    const foreign = await prisma.environment.create({ data: { projectId: other.id, ...prod, type: "STATIC" } });

    const res = await request(app).post("/api/runs").set("Authorization", `Bearer ${manager.token}`)
      .send({ projectId: project.id, name: "Smoke", environmentId: foreign.id, caseIds: [testCase.id] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ENVIRONMENT_NOT_IN_PROJECT");
  });

  it("the environment list counts runs and gives the latest", async () => {
    const { manager, project, env } = await setup();
    await prisma.testRun.create({ data: { projectId: project.id, name: "A", createdById: manager.id, environmentId: env.id, createdAt: new Date("2026-10-01T00:00:00Z") } });
    await prisma.testRun.create({ data: { projectId: project.id, name: "B", createdById: manager.id, environmentId: env.id, createdAt: new Date("2026-10-20T00:00:00Z") } });

    const list = await request(app).get("/api/environments").query({ projectId: project.id }).set("Authorization", `Bearer ${manager.token}`);

    expect(list.body[0]).toMatchObject({ runCount: 2, lastRunAt: "2026-10-20T00:00:00.000Z" });
  });
});

describe("company name and logo", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  it("an admin renames the company and sets a logo, and anyone reads them", async () => {
    const { admin, tester, company } = await seedBaseline();

    const res = await request(app).patch("/api/companies/current").set("Authorization", `Bearer ${admin.token}`).send({ name: "Shooters Global", logo: png });
    expect(res.status).toBe(200);

    const got = await request(app).get("/api/companies/current").set("Authorization", `Bearer ${tester.token}`);
    expect(got.body).toMatchObject({ id: company.id, name: "Shooters Global", logo: png });
  });

  it("removes the logo with null", async () => {
    const { admin } = await seedBaseline();
    await request(app).patch("/api/companies/current").set("Authorization", `Bearer ${admin.token}`).send({ logo: png });

    const res = await request(app).patch("/api/companies/current").set("Authorization", `Bearer ${admin.token}`).send({ logo: null });

    expect(res.body.logo).toBeNull();
  });

  it("accepts only small image data URLs", async () => {
    const { admin } = await seedBaseline();
    const bad = ["https://example.com/logo.png", "data:text/html;base64,PHNjcmlwdD4=", `data:image/png;base64,${"A".repeat(400_001)}`];
    for (const logo of bad) {
      const res = await request(app).patch("/api/companies/current").set("Authorization", `Bearer ${admin.token}`).send({ logo });
      expect(res.status).toBe(400);
    }
  });

  it("a tester cannot change them", async () => {
    const { tester } = await seedBaseline();

    const res = await request(app).patch("/api/companies/current").set("Authorization", `Bearer ${tester.token}`).send({ name: "Mine" });

    expect(res.status).toBe(403);
  });
});
