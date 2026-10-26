import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { app } from "../app";
import { prisma } from "../db";
import { resetDb, disconnect } from "./helpers/db";
import { seedBaseline, createProject, createSuite, createCase } from "./helpers/factories";

beforeAll(async () => { await resetDb(); });
afterAll(async () => { await disconnect(); });
beforeEach(async () => { await resetDb(); });

//   Gallery
//   └── Shotisize (2 cases)
//       └── Localization (1 case)
async function tree(companyId: string) {
  const project = await createProject({ companyId });
  const gallery = await createSuite({ projectId: project.id, name: "Gallery" });
  const shotisize = await createSuite({ projectId: project.id, name: "Shotisize", parentId: gallery.id });
  const localization = await createSuite({ projectId: project.id, name: "Localization", parentId: shotisize.id });
  await createCase({ suiteId: shotisize.id, title: "Shots open", priority: "HIGH", testLevel: "SMOKE" });
  await createCase({ suiteId: shotisize.id, title: "Shots play" });
  await createCase({ suiteId: localization.id, title: "French labels" });
  return { project, gallery, shotisize, localization };
}

describe("suite parent checks", () => {
  it("POST /api/suites rejects a parent from another project", async () => {
    const { manager, company } = await seedBaseline();
    const mine = await tree(company.id);
    const other = await tree(company.id);

    const res = await request(app).post("/api/suites").set("Authorization", `Bearer ${manager.token}`)
      .send({ projectId: mine.project.id, parentId: other.gallery.id, name: "Stray" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("SUITE_INVALID_PARENT");
  });

  it("PATCH /api/suites/:id moves a suite under another suite of the project", async () => {
    const { manager, company } = await seedBaseline();
    const { gallery, localization } = await tree(company.id);

    const res = await request(app).patch(`/api/suites/${localization.id}`).set("Authorization", `Bearer ${manager.token}`)
      .send({ parentId: gallery.id, name: "Localisation", description: "UI strings" });

    expect(res.status).toBe(200);
    const saved = await prisma.testSuite.findUniqueOrThrow({ where: { id: localization.id } });
    expect(saved).toMatchObject({ parentId: gallery.id, name: "Localisation", description: "UI strings" });
  });

  it("PATCH /api/suites/:id can move a suite to the project root", async () => {
    const { manager, company } = await seedBaseline();
    const { shotisize } = await tree(company.id);

    const res = await request(app).patch(`/api/suites/${shotisize.id}`).set("Authorization", `Bearer ${manager.token}`)
      .send({ parentId: null });

    expect(res.status).toBe(200);
    expect((await prisma.testSuite.findUniqueOrThrow({ where: { id: shotisize.id } })).parentId).toBeNull();
  });

  it("PATCH /api/suites/:id refuses to move a suite into itself or its own sub-suite", async () => {
    const { manager, company } = await seedBaseline();
    const { gallery, localization } = await tree(company.id);

    for (const parentId of [gallery.id, localization.id]) {
      const res = await request(app).patch(`/api/suites/${gallery.id}`).set("Authorization", `Bearer ${manager.token}`)
        .send({ parentId });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("SUITE_INVALID_PARENT");
    }
    expect((await prisma.testSuite.findUniqueOrThrow({ where: { id: gallery.id } })).parentId).toBeNull();
  });
});

describe("POST /api/suites/:id/duplicate", () => {
  it("copies the suite, its sub-suites and their cases next to the original", async () => {
    const { manager, company } = await seedBaseline();
    const { project, shotisize, gallery } = await tree(company.id);

    const res = await request(app).post(`/api/suites/${shotisize.id}/duplicate`).set("Authorization", `Bearer ${manager.token}`)
      .send({ name: "Shotisize copy" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Shotisize copy", parentId: gallery.id, projectId: project.id });
    const copy = await prisma.testSuite.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { cases: { orderBy: { title: "asc" } }, children: { include: { cases: true } } },
    });
    expect(copy.cases.map((c) => c.title)).toEqual(["Shots open", "Shots play"]);
    expect(copy.cases[0]).toMatchObject({ priority: "HIGH", testLevel: "SMOKE" });
    expect(copy.cases[0].cloneOfId).not.toBeNull();
    expect(copy.children.map((c) => c.name)).toEqual(["Localization"]);
    expect(copy.children[0].cases.map((c) => c.title)).toEqual(["French labels"]);
    // The original is untouched.
    expect(await prisma.testCase.count({ where: { suiteId: shotisize.id } })).toBe(2);
    expect(await prisma.testCase.count()).toBe(6);
  });

  it("is 404 for a suite in another company", async () => {
    const { manager, otherCompany } = await seedBaseline();
    const { gallery } = await tree(otherCompany.id);

    const res = await request(app).post(`/api/suites/${gallery.id}/duplicate`).set("Authorization", `Bearer ${manager.token}`).send({});

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("SUITE_NOT_FOUND");
  });

  it("is manager-only", async () => {
    const { tester, company } = await seedBaseline();
    const { gallery } = await tree(company.id);

    const res = await request(app).post(`/api/suites/${gallery.id}/duplicate`).set("Authorization", `Bearer ${tester.token}`).send({});

    expect(res.status).toBe(403);
  });
});
