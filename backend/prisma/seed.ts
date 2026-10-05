import { PrismaClient, Priority, TestLevel } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { readdirSync } from "fs";

const prisma = new PrismaClient();

type Step = { action: string; expected: string };
type CaseSpec = {
  title: string;
  priority: Priority;
  testLevel?: TestLevel;
  tags: string[];
  preconditions?: string;
  steps: Step[];
  estimatedMinutes?: number;
  requirements?: string[];
};
type SuiteSpec = { name: string; description?: string; cases: CaseSpec[] };
type ProjectSpec = { key: string; name: string; description: string; suites: SuiteSpec[] };

// --- Primary demo tenant: Acme QA ------------------------------------------

const ACME_CHECKOUT: ProjectSpec = {
  key: "CHECKOUT",
  name: "Acme Checkout",
  description:
    "End-to-end manual test coverage for Acme's checkout flow — cart, payment, shipping, and address management.",
  suites: [
    {
      name: "Cart",
      description: "Cart operations: add, remove, update quantities, persistence.",
      cases: [
        {
          title: "Add item to cart",
          priority: "CRITICAL",
          testLevel: "SMOKE",
          tags: ["smoke", "cart"],
          preconditions: "A product is available in stock.",
          estimatedMinutes: 3,
          requirements: ["ACME-1201"],
          steps: [
            { action: "Open a product detail page", expected: "Product name, price and Add-to-cart button are visible" },
            { action: "Tap Add to cart", expected: "Cart count increments and toast confirms the addition" },
            { action: "Open the cart", expected: "Product is listed with quantity 1 and correct price" },
          ],
        },
        {
          title: "Update item quantity in cart",
          priority: "HIGH",
          testLevel: "REGRESSION",
          tags: ["regression", "cart"],
          estimatedMinutes: 3,
          steps: [
            { action: "Open the cart with one item", expected: "Quantity input shows 1" },
            { action: "Change the quantity to 3", expected: "Line total recalculates and cart subtotal updates" },
            { action: "Reload the page", expected: "Quantity 3 persists" },
          ],
        },
        {
          title: "Remove item from cart",
          priority: "MEDIUM",
          testLevel: "REGRESSION",
          tags: ["regression", "cart"],
          estimatedMinutes: 2,
          steps: [
            { action: "Open a cart with two items", expected: "Both items are listed" },
            { action: "Tap the remove icon on the first item", expected: "Item is removed and subtotal updates" },
          ],
        },
        {
          title: "Empty cart shows placeholder",
          priority: "LOW",
          testLevel: "REGRESSION",
          tags: ["regression", "cart", "ux"],
          estimatedMinutes: 1,
          steps: [
            { action: "Open an empty cart", expected: "Placeholder illustration and 'Continue shopping' CTA are shown" },
            { action: "Tap Continue shopping", expected: "Returned to the product catalog" },
          ],
        },
      ],
    },
    {
      name: "Payment",
      description: "Payment gateway flows: credit card, saved card, 3-D Secure, declines.",
      cases: [
        {
          title: "Pay with new credit card",
          priority: "CRITICAL",
          testLevel: "SMOKE",
          tags: ["smoke", "payment"],
          preconditions: "A cart with at least one item.",
          estimatedMinutes: 4,
          requirements: ["ACME-1410"],
          steps: [
            { action: "Proceed to checkout", expected: "Payment form renders with card fields" },
            { action: "Enter a valid test card (4242 4242 4242 4242)", expected: "Field-level validation passes" },
            { action: "Submit the payment", expected: "Tokenisation succeeds and order confirmation is displayed" },
          ],
        },
        {
          title: "Pay with saved card",
          priority: "HIGH",
          testLevel: "REGRESSION",
          tags: ["regression", "payment"],
          preconditions: "Logged-in user has at least one saved payment method.",
          estimatedMinutes: 3,
          steps: [
            { action: "Proceed to checkout", expected: "Saved cards appear at the top of the payment options" },
            { action: "Select a saved card and confirm", expected: "No re-entry of CVV is required when the issuer allows frictionless flow" },
            { action: "Submit payment", expected: "Order is placed and confirmation is shown" },
          ],
        },
        {
          title: "Declined card shows a clear error",
          priority: "HIGH",
          testLevel: "ADVANCED",
          tags: ["negative", "payment"],
          estimatedMinutes: 3,
          steps: [
            { action: "Enter a card that the gateway declines (4000 0000 0000 0002)", expected: "Form accepts input" },
            { action: "Submit payment", expected: "Inline error is shown: 'Card was declined — try another card.' Order is NOT created." },
          ],
        },
        {
          title: "3-D Secure challenge flow",
          priority: "HIGH",
          testLevel: "REGRESSION",
          tags: ["regression", "payment", "3ds"],
          estimatedMinutes: 5,
          steps: [
            { action: "Use a 3DS test card (4000 0025 0000 3155)", expected: "Form accepts input" },
            { action: "Submit payment", expected: "Redirected to 3DS challenge page" },
            { action: "Complete the challenge", expected: "Redirected back to the store with a success confirmation" },
          ],
        },
      ],
    },
    {
      name: "Shipping & Address",
      description: "Shipping address selection, adding and editing addresses inside checkout.",
      cases: [
        {
          title: "Select a saved shipping address",
          priority: "HIGH",
          testLevel: "SMOKE",
          tags: ["smoke", "shipping"],
          preconditions: "User has at least one saved address.",
          estimatedMinutes: 2,
          steps: [
            { action: "Proceed to shipping step", expected: "Saved addresses are listed" },
            { action: "Select an address and continue", expected: "Address is applied; shipping quotes load" },
          ],
        },
        {
          title: "Add a new address during checkout",
          priority: "MEDIUM",
          testLevel: "REGRESSION",
          tags: ["regression", "shipping"],
          estimatedMinutes: 4,
          steps: [
            { action: "Tap Add new address", expected: "Address form opens" },
            { action: "Fill in all required fields and save", expected: "New address is persisted to the profile and applied to this order" },
          ],
        },
      ],
    },
  ],
};

const ACME_PORTAL: ProjectSpec = {
  key: "PORTAL",
  name: "Acme Customer Portal",
  description: "Self-service portal used by end customers to manage orders, subscriptions and profile data.",
  suites: [
    {
      name: "Account",
      description: "Authentication, profile management and account recovery.",
      cases: [
        {
          title: "Sign in with email and password",
          priority: "CRITICAL",
          testLevel: "SMOKE",
          tags: ["smoke", "auth"],
          preconditions: "A registered portal user exists.",
          estimatedMinutes: 2,
          steps: [
            { action: "Open the portal login page", expected: "Email and password fields are visible" },
            { action: "Enter valid credentials and submit", expected: "Redirected to the dashboard" },
          ],
        },
        {
          title: "Request password reset",
          priority: "HIGH",
          testLevel: "REGRESSION",
          tags: ["regression", "auth"],
          estimatedMinutes: 3,
          steps: [
            { action: "Tap Forgot password on the login page", expected: "Reset form opens" },
            { action: "Submit a registered email", expected: "Success confirmation is shown and a reset email arrives within 2 minutes" },
          ],
        },
        {
          title: "Update profile details",
          priority: "MEDIUM",
          testLevel: "REGRESSION",
          tags: ["regression", "profile"],
          estimatedMinutes: 3,
          steps: [
            { action: "Open Profile", expected: "Current name, email and phone are pre-filled" },
            { action: "Change the phone number and save", expected: "Success toast; refreshed value persists after reload" },
          ],
        },
      ],
    },
    {
      name: "Orders",
      description: "Viewing past orders and requesting returns.",
      cases: [
        {
          title: "View past orders",
          priority: "HIGH",
          testLevel: "SMOKE",
          tags: ["smoke", "orders"],
          estimatedMinutes: 2,
          steps: [
            { action: "Open Orders", expected: "Chronological list of past orders with status and totals" },
            { action: "Open one order", expected: "Order detail page shows items, shipping info, and invoice link" },
          ],
        },
        {
          title: "Request a return",
          priority: "MEDIUM",
          testLevel: "ADVANCED",
          tags: ["advanced", "orders"],
          preconditions: "An order is within the return window and has at least one returnable item.",
          estimatedMinutes: 5,
          steps: [
            { action: "Open the order and tap Request return", expected: "Return form lists returnable items" },
            { action: "Pick an item, choose a reason, and submit", expected: "Return case is created with a reference number and a confirmation email is sent" },
          ],
        },
      ],
    },
  ],
};

// --- Secondary tenant used to prove cross-company isolation ----------------

const GLOBEX_BILLING: ProjectSpec = {
  key: "BILLING",
  name: "Globex Billing",
  description: "Billing and invoicing for Globex subscriptions. Lives in a separate tenant to prove cross-company isolation.",
  suites: [
    {
      name: "Invoices",
      description: "Invoice generation and download.",
      cases: [
        {
          title: "Generate an invoice for a closed subscription period",
          priority: "HIGH",
          testLevel: "REGRESSION",
          tags: ["regression", "billing"],
          estimatedMinutes: 4,
          steps: [
            { action: "Trigger month-end billing job", expected: "Invoices are generated for every active subscription in the period" },
            { action: "Download a customer's PDF invoice", expected: "PDF contains correct customer, line items and totals" },
          ],
        },
        {
          title: "Tax is applied per customer address",
          priority: "MEDIUM",
          testLevel: "ADVANCED",
          tags: ["advanced", "billing", "tax"],
          estimatedMinutes: 5,
          steps: [
            { action: "Invoice a customer in an EU country", expected: "Line shows VAT at the country's rate" },
            { action: "Invoice a customer in a tax-exempt jurisdiction", expected: "No tax is applied and the exemption reason is noted on the invoice" },
          ],
        },
      ],
    },
  ],
};

// --- Core seeding helpers --------------------------------------------------

async function seedProject(spec: ProjectSpec, companyId: string) {
  const existing = await prisma.project.findFirst({ where: { companyId, key: spec.key } });
  if (existing) {
    console.log(`Seed: project ${spec.key} already exists, skipping.`);
    return existing;
  }
  const project = await prisma.project.create({
    data: { companyId, key: spec.key, name: spec.name, description: spec.description },
  });
  for (const suiteSpec of spec.suites) {
    const suite = await prisma.testSuite.create({
      data: { projectId: project.id, name: suiteSpec.name, description: suiteSpec.description },
    });
    for (const c of suiteSpec.cases) {
      await prisma.testCase.create({
        data: {
          suiteId: suite.id,
          title: c.title,
          priority: c.priority,
          testLevel: c.testLevel ?? "REGRESSION",
          tags: c.tags,
          preconditions: c.preconditions,
          steps: c.steps,
          estimatedMinutes: c.estimatedMinutes,
          requirements: c.requirements ?? [],
        },
      });
    }
  }
  const caseCount = spec.suites.reduce((n, s) => n + s.cases.length, 0);
  console.log(`Seed: created project ${spec.key} (${spec.suites.length} suites, ${caseCount} cases).`);
  return project;
}

async function upsertUser(email: string, name: string, password: string, role: "MANAGER" | "TESTER", companyId: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.companyId !== companyId || existing.role !== role || !existing.emailVerifiedAt) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { companyId, role, name, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() },
      });
    }
    return existing;
  }
  return prisma.user.create({
    data: { email, name, passwordHash: await bcrypt.hash(password, 10), role, companyId, emailVerifiedAt: new Date() },
  });
}

async function seedMilestones(projectId: string) {
  const existing = await prisma.milestone.findFirst({ where: { projectId } });
  if (existing) return;
  await prisma.milestone.createMany({
    data: [
      {
        projectId,
        name: "Release 2026.Q2 — Payments hardening",
        description: "3DS rollout, declined-card UX and gateway retry behaviour.",
        status: "ACTIVE",
        dueDate: new Date(Date.now() + 21 * 24 * 3600 * 1000),
      },
      {
        projectId,
        name: "Q3 exploratory sweep",
        description: "Planned exploratory pass across checkout + portal before feature freeze.",
        status: "PLANNED",
        dueDate: new Date(Date.now() + 90 * 24 * 3600 * 1000),
      },
    ],
  });
  console.log("Seed: created 2 milestones for Acme Checkout.");
}

async function seedRunsForCheckout(projectId: string, managerId: string, testerId: string) {
  const existingRun = await prisma.testRun.findFirst({
    where: { projectId, name: { contains: "Smoke — Chrome" } },
  });
  if (existingRun) {
    console.log("Seed: sample runs already exist, skipping.");
    return;
  }

  const activeMilestone = await prisma.milestone.findFirst({
    where: { projectId, status: "ACTIVE" },
  });

  const cartSuite = await prisma.testSuite.findFirst({
    where: { projectId, name: "Cart" },
    include: { cases: { orderBy: { createdAt: "asc" } } },
  });
  const paymentSuite = await prisma.testSuite.findFirst({
    where: { projectId, name: "Payment" },
    include: { cases: { orderBy: { createdAt: "asc" } } },
  });
  if (!cartSuite || !paymentSuite) return;

  const smokeCaseIds = [
    ...cartSuite.cases.filter((c) => c.tags.includes("smoke")).map((c) => c.id),
    ...paymentSuite.cases.filter((c) => c.tags.includes("smoke")).map((c) => c.id),
  ];
  const allCheckoutCaseIds = [...cartSuite.cases, ...paymentSuite.cases].map((c) => c.id);
  const titleByCaseId = new Map(
    [...cartSuite.cases, ...paymentSuite.cases].map((c) => [c.id, c.title]),
  );

  // --- Run 1: completed smoke on Chrome, all green ---
  const completedRun = await prisma.testRun.create({
    data: {
      projectId,
      milestoneId: activeMilestone?.id,
      name: "Smoke — Chrome / Prod",
      description: "Release-candidate smoke pass for checkout on Chrome, production environment.",
      environment: "Chrome 120 / Prod",
      platforms: ["WEB"],
      connectivities: ["ONLINE"],
      locales: ["en"],
      locale: "en",
      status: "COMPLETED",
      createdById: managerId,
      completedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      executions: { create: smokeCaseIds.map((caseId) => ({ caseId, assigneeId: testerId })) },
    },
    include: { executions: true },
  });

  for (let i = 0; i < completedRun.executions.length; i++) {
    await prisma.testExecution.update({
      where: { id: completedRun.executions[i].id },
      data: {
        status: "PASSED",
        actualResult: "Flow matched the expected outcome on Chrome/Prod.",
        durationMinutes: 3 + (i % 3),
        executedById: testerId,
        executedAt: new Date(Date.now() - (2 * 24 + (smokeCaseIds.length - i)) * 3600 * 1000),
      },
    });
  }

  // --- Run 2: full checkout regression on iOS, one real failure ---
  const regression = await prisma.testRun.create({
    data: {
      projectId,
      milestoneId: activeMilestone?.id,
      name: "Regression — iOS / Staging",
      description: "Full cart + payment regression on iOS Safari, staging.",
      environment: "iOS 17 / Staging",
      platforms: ["IOS"],
      connectivities: ["ONLINE"],
      locales: ["en"],
      locale: "en",
      dueDate: new Date(Date.now() + 3 * 24 * 3600 * 1000),
      status: "IN_PROGRESS",
      createdById: managerId,
      executions: { create: allCheckoutCaseIds.map((caseId) => ({ caseId, assigneeId: testerId })) },
    },
    include: { executions: true },
  });

  type Plan = { status: "PASSED" | "FAILED" | "PENDING" | "SKIPPED"; notes?: string; failureReason?: string; actualResult?: string; duration?: number; jira?: string };
  const regressionPlan: Record<number, Plan> = {
    0: { status: "PASSED", duration: 3, actualResult: "Item appeared in cart with correct price." },
    1: { status: "PASSED", duration: 4, actualResult: "Quantity update persisted across reload." },
    2: { status: "PASSED", duration: 2, actualResult: "Item removed as expected." },
    3: { status: "PASSED", duration: 1, actualResult: "Placeholder renders correctly." },
    4: { status: "PASSED", duration: 5, actualResult: "Order placed with a new card." },
    5: {
      status: "FAILED",
      duration: 7,
      actualResult: "Saved-card list is empty even though the user has two saved cards in the account.",
      failureReason: "On iOS Safari the saved-cards endpoint is called before the session cookie is attached; the 401 is silently swallowed. Repro 3/3.",
      notes: "Tested on iPhone 14 and iPhone 15. Chrome iOS not affected.",
      jira: "PAY-812",
    },
    6: { status: "PENDING" },
    7: { status: "PENDING" },
  };

  for (let i = 0; i < regression.executions.length; i++) {
    const plan = regressionPlan[i];
    if (!plan || plan.status === "PENDING") continue;
    await prisma.testExecution.update({
      where: { id: regression.executions[i].id },
      data: {
        status: plan.status,
        notes: plan.notes,
        failureReason: plan.failureReason,
        actualResult: plan.actualResult,
        durationMinutes: plan.duration,
        executedById: testerId,
        executedAt: new Date(Date.now() - (12 - i) * 3600 * 1000),
        jiraIssueKey: plan.jira,
        jiraIssueUrl: plan.jira ? `https://example.atlassian.net/browse/${plan.jira}` : null,
      },
    });
  }

  // --- Run 3: Android / Offline — most things skipped to show matrix variety ---
  const androidOffline = await prisma.testRun.create({
    data: {
      projectId,
      name: "Offline pass — Android / Staging / en",
      description: "Offline behaviour of the cart, Android Chrome.",
      environment: "Android 14 / Staging",
      platforms: ["ANDROID"],
      connectivities: ["OFFLINE"],
      locales: ["en"],
      locale: "en",
      status: "COMPLETED",
      createdById: managerId,
      completedAt: new Date(Date.now() - 24 * 3600 * 1000),
      executions: { create: allCheckoutCaseIds.map((caseId) => ({ caseId, assigneeId: testerId })) },
    },
    include: { executions: true },
  });

  const offlinePlan: Array<"PASSED" | "SKIPPED"> = ["PASSED", "SKIPPED", "PASSED", "PASSED", "SKIPPED", "SKIPPED", "SKIPPED", "SKIPPED"];
  for (let i = 0; i < androidOffline.executions.length; i++) {
    const status = offlinePlan[i] ?? "SKIPPED";
    await prisma.testExecution.update({
      where: { id: androidOffline.executions[i].id },
      data: {
        status,
        executedById: testerId,
        executedAt: new Date(Date.now() - (24 + 6 - i) * 3600 * 1000),
        notes: status === "SKIPPED" ? "Requires network connectivity — not applicable offline." : undefined,
        actualResult: status === "PASSED" ? "Cart behaved correctly offline." : undefined,
      },
    });
  }

  // --- Run 4: Windows / fr smoke with a localisation failure ---
  const windowsFr = await prisma.testRun.create({
    data: {
      projectId,
      name: "Smoke — Windows / fr",
      description: "French-locale smoke pass on Windows / Edge.",
      environment: "Windows 11 / Edge / Prod",
      platforms: ["WINDOWS"],
      connectivities: ["ONLINE"],
      locales: ["fr"],
      locale: "fr",
      status: "IN_PROGRESS",
      createdById: managerId,
      executions: { create: smokeCaseIds.map((caseId) => ({ caseId, assigneeId: testerId })) },
    },
    include: { executions: true },
  });

  const windowsPlan: Array<"PASSED" | "FAILED" | "PENDING"> = ["PASSED", "FAILED", "PENDING", "PENDING"];
  for (let i = 0; i < windowsFr.executions.length; i++) {
    const status = windowsPlan[i];
    if (!status || status === "PENDING") continue;
    await prisma.testExecution.update({
      where: { id: windowsFr.executions[i].id },
      data: {
        status,
        executedById: testerId,
        executedAt: new Date(Date.now() - (10 - i) * 3600 * 1000),
        actualResult:
          status === "PASSED"
            ? "OK in French."
            : "Checkout button falls back to English when the browser reports fr-CA. Expected to honour any fr-* variant.",
        failureReason:
          status === "FAILED"
            ? "Locale negotiation only matches exact tags; fr-CA does not map to fr."
            : undefined,
      },
    });
  }

  // --- Activity + comments so feeds aren't empty ---
  for (const run of [completedRun, regression, androidOffline, windowsFr]) {
    await prisma.activityLog.create({
      data: {
        projectId,
        userId: managerId,
        action: "RUN_CREATED",
        entityType: "run",
        entityId: run.id,
        payload: { name: run.name, caseCount: run.executions.length },
      },
    });
  }

  const failedExec = regression.executions[5];
  if (failedExec) {
    await prisma.activityLog.create({
      data: {
        projectId,
        userId: testerId,
        action: "EXECUTION_STATUS_CHANGED",
        entityType: "execution",
        entityId: failedExec.id,
        payload: { from: "PENDING", to: "FAILED", case: titleByCaseId.get(failedExec.caseId) },
      },
    });
    await prisma.activityLog.create({
      data: {
        projectId,
        userId: testerId,
        action: "JIRA_LINKED",
        entityType: "execution",
        entityId: failedExec.id,
        payload: { issueKey: "PAY-812" },
      },
    });
    await prisma.comment.create({
      data: {
        body: "Reproduced on two devices. Escalated to the web platform team; tracking as PAY-812.",
        userId: testerId,
        executionId: failedExec.id,
      },
    });
    await prisma.comment.create({
      data: {
        body: "Thanks — let's retest once the session-cookie patch lands in staging.",
        userId: managerId,
        executionId: failedExec.id,
      },
    });
  }

  console.log("Seed: created 4 runs (smoke, full regression, offline, localisation) for Acme Checkout.");
}

// Generic bootstrapper: give any project a milestone, one run with a mix of
// PASSED/FAILED/PENDING executions spanning every case, plus an activity-log
// entry and a comment on the failure. Used for the "less important" demo
// projects so every page has something to render.
async function seedProjectBasics(opts: {
  projectId: string;
  managerId: string;
  testerId: string;
  runName: string;
  runDescription: string;
  environment: string;
  platform: string;
  connectivity: string;
  locale: string;
  failureReason?: string;
  jiraIssueKey?: string;
}) {
  const { projectId, managerId, testerId, runName, runDescription } = opts;

  const existing = await prisma.testRun.findFirst({ where: { projectId, name: runName } });
  if (existing) return;

  await prisma.milestone.createMany({
    data: [
      {
        projectId,
        name: "Current iteration",
        description: "Work-in-flight for this project.",
        status: "ACTIVE",
        dueDate: new Date(Date.now() + 14 * 24 * 3600 * 1000),
      },
    ],
    skipDuplicates: true,
  });

  const cases = await prisma.testCase.findMany({
    where: { suite: { projectId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true },
  });
  if (cases.length === 0) return;

  const milestone = await prisma.milestone.findFirst({ where: { projectId, status: "ACTIVE" } });

  const run = await prisma.testRun.create({
    data: {
      projectId,
      milestoneId: milestone?.id,
      name: runName,
      description: runDescription,
      environment: opts.environment,
      platforms: [opts.platform],
      connectivities: [opts.connectivity],
      locales: [opts.locale],
      locale: opts.locale,
      status: "IN_PROGRESS",
      createdById: managerId,
      executions: { create: cases.map((c) => ({ caseId: c.id, assigneeId: testerId })) },
    },
    include: { executions: true },
  });

  // Status plan: first case PASSED, second FAILED (if we have ≥2), rest alternate PASSED/PENDING.
  for (let i = 0; i < run.executions.length; i++) {
    const exec = run.executions[i];
    if (i === 1 && run.executions.length > 1) {
      await prisma.testExecution.update({
        where: { id: exec.id },
        data: {
          status: "FAILED",
          failureReason: opts.failureReason ?? "Observed behaviour does not match the expected outcome — see actual result.",
          actualResult: "Reproduced twice on the configured environment.",
          durationMinutes: 6,
          executedById: testerId,
          executedAt: new Date(Date.now() - 6 * 3600 * 1000),
          jiraIssueKey: opts.jiraIssueKey,
          jiraIssueUrl: opts.jiraIssueKey ? `https://example.atlassian.net/browse/${opts.jiraIssueKey}` : null,
        },
      });
    } else if (i % 2 === 0) {
      await prisma.testExecution.update({
        where: { id: exec.id },
        data: {
          status: "PASSED",
          actualResult: "Behaviour matches the expected outcome.",
          durationMinutes: 3,
          executedById: testerId,
          executedAt: new Date(Date.now() - (12 - i) * 3600 * 1000),
        },
      });
    }
    // odd indices other than 1 stay PENDING
  }

  await prisma.activityLog.create({
    data: {
      projectId,
      userId: managerId,
      action: "RUN_CREATED",
      entityType: "run",
      entityId: run.id,
      payload: { name: run.name, caseCount: cases.length },
    },
  });

  const failed = run.executions[1];
  if (failed) {
    await prisma.comment.create({
      data: {
        body: "Caught on first pass. Will retest after the next deploy.",
        userId: testerId,
        executionId: failed.id,
      },
    });
  }

  console.log(`Seed: bootstrapped project ${projectId.slice(-6)} with 1 milestone + 1 run (${cases.length} executions).`);
}

async function seedApiTokens(userId: string) {
  const existing = await prisma.apiToken.findFirst({ where: { userId, name: "CI seed token" } });
  if (existing) return;
  const plaintext = "ts_" + randomBytes(24).toString("base64url");
  await prisma.apiToken.create({
    data: {
      userId,
      name: "CI seed token",
      tokenHash: createHash("sha256").update(plaintext).digest("hex"),
    },
  });
  console.log(`Seed: ApiToken created (demo plaintext: ${plaintext}). Use as 'Authorization: Bearer <token>'.`);
}

async function seedAttachments(companyId: string, managerId: string, testerId: string) {
  const existing = await prisma.attachment.findFirst({
    where: { uploadedBy: { companyId }, storageKey: { startsWith: "seed/" } },
  });
  if (existing) return;

  const project = await prisma.project.findFirst({ where: { companyId, key: "CHECKOUT" } });
  if (!project) return;

  const anyCase = await prisma.testCase.findFirst({
    where: { suite: { project: { id: project.id } } },
    orderBy: { createdAt: "asc" },
  });

  const failedExec = await prisma.testExecution.findFirst({
    where: { run: { projectId: project.id }, status: "FAILED" },
  });

  const rows: Array<Parameters<typeof prisma.attachment.create>[0]["data"]> = [];

  if (anyCase) {
    rows.push({
      caseId: anyCase.id,
      uploadedById: managerId,
      filename: "cart-mockup.png",
      mimeType: "image/png",
      size: 42_315,
      storageKey: `seed/cases/${anyCase.id}/cart-mockup.png`,
    });
  }
  if (failedExec) {
    rows.push({
      executionId: failedExec.id,
      uploadedById: testerId,
      filename: "repro-ios-saved-cards.mp4",
      mimeType: "video/mp4",
      size: 812_430,
      storageKey: `seed/executions/${failedExec.id}/repro-ios-saved-cards.mp4`,
    });
    rows.push({
      executionId: failedExec.id,
      uploadedById: testerId,
      filename: "network-trace.har",
      mimeType: "application/json",
      size: 38_221,
      storageKey: `seed/executions/${failedExec.id}/network-trace.har`,
    });
  }

  for (const data of rows) {
    await prisma.attachment.create({ data });
  }
  if (rows.length) {
    console.log(`Seed: created ${rows.length} Attachment rows (metadata only — download will 404 unless re-uploaded).`);
  }
}

async function seedRequirements(projectId: string) {
  const existing = await prisma.requirement.count({ where: { projectId } });
  if (existing > 0) return;

  // Match external refs to the ones baked into ACME_CHECKOUT case `requirements` strings
  // so the traceability matrix lines up with the legacy free-text requirements.
  const specs = [
    {
      externalRef: "ACME-1201",
      title: "Customer can add items to the cart",
      description: "Any product page must let an authenticated or anonymous shopper add items to the cart and have that state persist for 24 hours.",
      linkTo: ["Add item to cart", "Update item quantity in cart"],
    },
    {
      externalRef: "ACME-1410",
      title: "Checkout accepts major card networks",
      description: "Checkout must tokenise Visa, Mastercard, and Amex via the gateway, and handle 3-D Secure challenges for supported issuers.",
      linkTo: ["Pay with new credit card", "3-D Secure challenge flow", "Declined card shows a clear error"],
    },
    {
      externalRef: "ACME-1520",
      title: "Shipping address management",
      description: "Customers can use a saved shipping address or create a new one inline during checkout.",
      linkTo: ["Select a saved shipping address", "Add a new address during checkout"],
    },
  ];

  for (const spec of specs) {
    const caseRows = await prisma.testCase.findMany({
      where: { suite: { projectId }, title: { in: spec.linkTo } },
      select: { id: true },
    });
    const req = await prisma.requirement.create({
      data: {
        projectId,
        externalRef: spec.externalRef,
        title: spec.title,
        description: spec.description,
      },
    });
    if (caseRows.length > 0) {
      await prisma.requirement.update({
        where: { id: req.id },
        data: { cases: { connect: caseRows.map((c) => ({ id: c.id })) } },
      });
    }
  }
  console.log(`Seed: created ${specs.length} requirements for Acme Checkout with linked cases.`);
}

async function seedJiraConfigFromEnv(companyId: string, primaryProjectKey?: string) {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_USER;
  const apiToken = process.env.JIRA_TOKEN;
  const jiraProjectKey = process.env.JIRA_PROJECT_KEY;
  if (!baseUrl || !email || !apiToken) {
    console.log("Seed: Jira env vars missing, skipping auto-config.");
    return;
  }
  await prisma.jiraConfig.upsert({
    where: { companyId },
    update: { baseUrl, email, apiToken, enabled: true },
    create: { companyId, baseUrl, email, apiToken, defaultIssueType: "Bug", enabled: true },
  });
  console.log(`Seed: Jira company config set (baseUrl=${baseUrl}).`);

  if (jiraProjectKey && primaryProjectKey) {
    await prisma.project.updateMany({
      where: { companyId, key: primaryProjectKey },
      data: { jiraProjectKey, jiraProjectName: jiraProjectKey },
    });
    console.log(`Seed: project ${primaryProjectKey} bound to Jira project ${jiraProjectKey}.`);
  }
}

// --- Entrypoint ------------------------------------------------------------

async function main() {
  // Primary demo tenant
  const acme = await prisma.company.upsert({
    where: { slug: "acme-qa" },
    update: {},
    create: { name: "Acme QA", slug: "acme-qa" },
  });
  const acmeManager = await upsertUser("manager@acme.local", "Alex Acme", "acme123", "MANAGER", acme.id);
  const acmeTester = await upsertUser("tester@acme.local", "Bilal Acme", "acme123", "TESTER", acme.id);

  const checkout = await seedProject(ACME_CHECKOUT, acme.id);
  const portal = await seedProject(ACME_PORTAL, acme.id);
  if (checkout) {
    await seedMilestones(checkout.id);
    await seedRunsForCheckout(checkout.id, acmeManager.id, acmeTester.id);
    await seedAttachments(acme.id, acmeManager.id, acmeTester.id);
    await seedRequirements(checkout.id);
  }
  if (portal) {
    await seedProjectBasics({
      projectId: portal.id,
      managerId: acmeManager.id,
      testerId: acmeTester.id,
      runName: "Portal smoke — Chrome / Prod",
      runDescription: "Smoke pass over the customer portal on Chrome, production environment.",
      environment: "Chrome 120 / Prod",
      platform: "WEB",
      connectivity: "ONLINE",
      locale: "en",
      failureReason:
        "Profile update submits the old phone number when the field is blurred by tabbing into Save — form state is not committed before submit.",
      jiraIssueKey: "POR-204",
    });
  }
  await seedApiTokens(acmeManager.id);
  await seedJiraConfigFromEnv(acme.id, "CHECKOUT");

  // Secondary tenant — proves cross-company isolation
  const globex = await prisma.company.upsert({
    where: { slug: "globex-qa" },
    update: {},
    create: { name: "Globex QA", slug: "globex-qa" },
  });
  const globexManager = await upsertUser("manager@globex.local", "Casey Globex", "globex123", "MANAGER", globex.id);
  const globexTester = await upsertUser("tester@globex.local", "Dana Globex", "globex123", "TESTER", globex.id);
  const billing = await seedProject(GLOBEX_BILLING, globex.id);
  if (billing) {
    await seedProjectBasics({
      projectId: billing.id,
      managerId: globexManager.id,
      testerId: globexTester.id,
      runName: "Billing sanity — Staging / EU",
      runDescription: "Sanity pass over invoice generation and tax rules in the EU region.",
      environment: "Linux / Staging / EU",
      platform: "WEB",
      connectivity: "ONLINE",
      locale: "en",
      failureReason: "VAT rate for reverse-charge customers is applied at 0% but the note is missing from the invoice footer.",
      jiraIssueKey: "BIL-58",
    });
  }

  // Optional local-only extensions (gitignored): seed.hapster.ts, then every
  // seed.*.local.ts in alphabetical order. Present on developer machines that
  // need extra tenant fixtures on top of the generic demo. Safe no-op when
  // the files are absent, which is the case for the public repo.
  const localSeeds = [
    "./seed.hapster",
    ...readdirSync(__dirname)
      .filter((f) => /^seed\..+\.local\.ts$/.test(f))
      .sort()
      .map((f) => `./${f.replace(/\.ts$/, "")}`),
  ];
  for (const path of localSeeds) {
    try {
      const mod: { default?: (p: typeof prisma) => Promise<void> } = await import(path);
      if (typeof mod.default === "function") {
        await mod.default(prisma);
      }
    } catch (e: any) {
      if (e?.code !== "ERR_MODULE_NOT_FOUND" && e?.code !== "MODULE_NOT_FOUND") throw e;
    }
  }

  console.log("\nSeed complete.");
  console.log("  Acme QA (primary) manager:  manager@acme.local / acme123");
  console.log("  Acme QA (primary) tester:   tester@acme.local / acme123");
  console.log("  Globex QA (isolation test): manager@globex.local / globex123");
  console.log("                              tester@globex.local / globex123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
