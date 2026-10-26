import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { prisma } from "../../db";
import { signToken } from "../../middleware/auth";
import { ensureDefaultOptions } from "../../lib/testConfig";

type Role = "ADMIN" | "MANAGER" | "TESTER" | "VIEWER";

function rand(prefix = "") {
  return prefix + randomBytes(4).toString("hex");
}

export async function createCompany(name = "Acme QA", withDefaults = true) {
  const c = await prisma.company.create({
    data: { name, slug: rand("acme-") },
  });
  if (withDefaults) await ensureDefaultOptions(c.id);
  return c;
}

export type TestUser = {
  id: string;
  email: string;
  role: Role;
  companyId: string;
  token: string;
};

export async function createUser(opts: {
  companyId: string;
  role?: Role;
  email?: string;
  name?: string;
  password?: string;
  verified?: boolean;
}): Promise<TestUser> {
  const password = opts.password ?? "StrongPass123!";
  const email = opts.email ?? rand("user-") + "@test.local";
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await prisma.user.create({
    data: {
      email,
      name: opts.name ?? "Test User",
      passwordHash,
      role: opts.role ?? "TESTER",
      companyId: opts.companyId,
      emailVerifiedAt: opts.verified === false ? null : new Date(),
    },
  });
  const token = signToken({
    id: user.id,
    email: user.email,
    role: user.role as Role,
    companyId: user.companyId,
  });
  return { id: user.id, email: user.email, role: user.role as Role, companyId: user.companyId, token };
}

export async function createProject(opts: {
  companyId: string;
  key?: string;
  name?: string;
  customFields?: unknown;
}) {
  return prisma.project.create({
    data: {
      companyId: opts.companyId,
      key: opts.key ?? rand("P").toUpperCase(),
      name: opts.name ?? "Test Project",
      ...(opts.customFields ? { customFields: opts.customFields as object } : {}),
    },
  });
}

export async function createSuite(opts: { projectId: string; name?: string; parentId?: string }) {
  return prisma.testSuite.create({
    data: {
      projectId: opts.projectId,
      name: opts.name ?? "Test Suite",
      parentId: opts.parentId,
    },
  });
}

export async function createCase(opts: {
  suiteId: string;
  title?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  testLevel?: "SMOKE" | "SANITY" | "REGRESSION" | "ADVANCED" | "EXPLORATORY";
  steps?: { action: string; expected: string }[];
}) {
  return prisma.testCase.create({
    data: {
      suiteId: opts.suiteId,
      title: opts.title ?? "Test Case",
      priority: opts.priority ?? "MEDIUM",
      testLevel: opts.testLevel ?? "REGRESSION",
      steps: (opts.steps ?? [{ action: "do thing", expected: "thing done" }]) as object,
    },
  });
}

export async function createMilestone(opts: { projectId: string; name?: string }) {
  return prisma.milestone.create({
    data: {
      projectId: opts.projectId,
      name: opts.name ?? rand("Milestone "),
    },
  });
}

/**
 * Creates a baseline tenant with a manager, a tester, a viewer, and a second
 * company with its own manager (used for cross-tenant isolation tests).
 */
export async function seedBaseline() {
  const company = await createCompany();
  const admin = await createUser({ companyId: company.id, role: "ADMIN", name: "Admin" });
  const manager = await createUser({ companyId: company.id, role: "MANAGER", name: "Manager" });
  const tester = await createUser({ companyId: company.id, role: "TESTER", name: "Tester" });
  const viewer = await createUser({ companyId: company.id, role: "VIEWER", name: "Viewer" });

  const otherCompany = await createCompany("Other Co");
  const otherManager = await createUser({ companyId: otherCompany.id, role: "MANAGER", name: "Other Manager" });

  return { company, admin, manager, tester, viewer, otherCompany, otherManager };
}
