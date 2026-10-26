import { prisma } from "../db";
import { httpError } from "../middleware/error";
import { logger } from "./logger";
import { appUrl } from "./mailer";

type AdfNode = Record<string, unknown>;
type AdfDoc = { type: "doc"; version: 1; content: AdfNode[] };

export const DEFAULT_SUMMARY_TEMPLATE = "[{{suiteName}}] {{caseTitle}} failed";

export const DEFAULT_DESCRIPTION_TEMPLATE = [
  "Auto-created from SuitesGlobal run: {{runName}}",
  "Project: {{projectName}} ({{projectKey}})",
  "Suite: {{suiteName}}",
  "Test case: {{caseTitle}}",
  "Tester: {{tester}}",
  "Failing combination: {{combo}}",
  "Platform: {{platform}}",
  "Connectivity: {{connectivity}}",
  "Locale: {{locale}}",
  "Environment: {{environment}}",
  "",
  "## Preconditions",
  "{{preconditions}}",
  "",
  "## Steps",
  "{{steps}}",
  "",
  "## Failure reason",
  "{{failureReason}}",
  "",
  "## Actual result",
  "{{actualResult}}",
  "",
  "---",
  "[View in SuitesGlobal]({{executionUrl}})",
].join("\n");

function textRuns(raw: string): AdfNode[] {
  if (!raw) return [];
  // Bold **x**, italic *x*, inline code `x`, links [text](url). Plain otherwise.
  const out: AdfNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(raw)) !== null) {
    if (m.index > last) out.push({ type: "text", text: raw.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ type: "text", text: m[2], marks: [{ type: "strong" }] });
    else if (m[3] !== undefined) out.push({ type: "text", text: m[3], marks: [{ type: "em" }] });
    else if (m[4] !== undefined) out.push({ type: "text", text: m[4], marks: [{ type: "code" }] });
    else if (m[5] !== undefined && m[6] !== undefined) out.push({ type: "text", text: m[5], marks: [{ type: "link", attrs: { href: m[6] } }] });
    last = m.index + m[0].length;
  }
  if (last < raw.length) out.push({ type: "text", text: raw.slice(last) });
  return out;
}

function paragraph(text: string): AdfNode {
  const runs = textRuns(text);
  return runs.length ? { type: "paragraph", content: runs } : { type: "paragraph" };
}

// Convert a small markdown-like string to Atlassian Document Format so headings
// and lists render natively in Jira Cloud instead of showing "## foo" literally.
// Supports: h1-h6 headings, dash/asterisk bullets, numbered lists, fenced code,
// blank-line paragraph breaks, and inline bold/italic/code marks.
function mdToAdf(text: string): AdfDoc {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const content: AdfNode[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().replace(/^```/, "").trim() || null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      content.push({
        type: "codeBlock",
        attrs: lang ? { language: lang } : {},
        content: [{ type: "text", text: body.join("\n") }],
      });
      continue;
    }

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length, 6);
      content.push({ type: "heading", attrs: { level }, content: textRuns(h[2]) });
      i++;
      continue;
    }

    // Ordered list (consume contiguous N. items + indented continuation lines)
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const head = lines[i].replace(/^\s*\d+\.\s+/, "");
        const itemLines = [head];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          itemLines.push(lines[i].trimStart());
          i++;
        }
        items.push({
          type: "listItem",
          content: itemLines.map((l) => paragraph(l)),
        });
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: AdfNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const head = lines[i].replace(/^\s*[-*]\s+/, "");
        const itemLines = [head];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
          itemLines.push(lines[i].trimStart());
          i++;
        }
        items.push({
          type: "listItem",
          content: itemLines.map((l) => paragraph(l)),
        });
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // Paragraph — consume consecutive non-empty non-special lines as one paragraph
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|\s*[-*]\s+|\s*\d+\.\s+|```)/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    content.push(paragraph(paraLines.join(" ")));
  }

  return { type: "doc", version: 1, content };
}

function basicAuth(email: string, token: string) {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "—");
}

/**
 * Resolve the Jira accountId of the token owner (the email configured in
 * JiraConfig.email). Cached per process for the lifetime of the pod so we
 * don't hit /myself on every bug creation. Used as a fallback reporter when
 * the tester hasn't linked their own Jira account on their profile.
 */
const tokenOwnerAccountCache = new Map<string, string>();
async function getTokenOwnerAccountId(config: { baseUrl: string; email: string; apiToken: string }): Promise<string | null> {
  const key = `${config.baseUrl.replace(/\/$/, "")}|${config.email}`;
  const hit = tokenOwnerAccountCache.get(key);
  if (hit) return hit;
  try {
    const me = await jiraFetch<{ accountId?: string }>(config, "/rest/api/3/myself");
    if (me.accountId) {
      tokenOwnerAccountCache.set(key, me.accountId);
      return me.accountId;
    }
    return null;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "failed to resolve Jira token owner accountId");
    return null;
  }
}

export async function jiraFetch<T>(
  config: { baseUrl: string; email: string; apiToken: string },
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${config.baseUrl.replace(/\/$/, "")}${path}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: basicAuth(config.email, config.apiToken),
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    const text = await resp.text();
    logger.error({ jiraPath: path, status: resp.status, body: text.slice(0, 500) }, "jira request failed");
    throw httpError(resp.status, "JIRA_REQUEST_FAILED");
  }
  return resp.json() as Promise<T>;
}

export async function createJiraBugForExecution(executionId: string, callerUserId?: string) {
  const execution = await prisma.testExecution.findUnique({
    where: { id: executionId },
    include: {
      case: { include: { suite: { include: { project: { include: { company: { include: { jiraConfig: true } } } } } } } },
      run: true,
      executedBy: { select: { name: true, email: true, jiraAccountId: true } },
    },
  });
  // Reporter = the caller (whoever clicked Create Bug). Fall back to the
  // historical tester (executedBy) so that Jira reporter still works for
  // background/workflow jobs that don't have a caller user id.
  const caller = callerUserId
    ? await prisma.user.findUnique({
        where: { id: callerUserId },
        select: { name: true, email: true, jiraAccountId: true },
      })
    : null;
  const reporter = caller ?? execution?.executedBy ?? null;
  if (!execution) throw httpError(404, "EXECUTION_NOT_FOUND");
  if (execution.jiraIssueKey) throw httpError(409, "JIRA_ISSUE_ALREADY_LINKED");
  if (execution.status !== "FAILED") throw httpError(400, "EXECUTION_NOT_FAILED");

  const project = execution.case.suite.project;
  const config = project.company.jiraConfig;
  if (!config || !config.enabled) throw httpError(400, "JIRA_NOT_CONFIGURED");
  if (!project.jiraProjectKey) throw httpError(400, "JIRA_PROJECT_NOT_SET");

  const stepsText = (execution.case.steps as Array<{ action: string; expected: string }>)
    .map((s, i) => `${i + 1}. ${s.action}\n   *Expected:* ${s.expected}`)
    .join("\n");

  const executionUrl = `${appUrl}/runs/${execution.run.id}`;

  const vars: Record<string, string> = {
    caseTitle: execution.case.title,
    suiteName: execution.case.suite.name,
    projectName: project.name,
    projectKey: project.key,
    runName: execution.run.name,
    environment: execution.run.environment ?? "—",
    platform: execution.run.platforms?.join(", ") || "—",
    connectivity: execution.run.connectivities?.join(", ") || "—",
    locale: execution.run.locale ?? "—",
    combo: "—",
    tester: execution.executedBy?.name ?? "unknown",
    preconditions: execution.case.preconditions || "—",
    steps: stepsText || "—",
    failureReason: execution.failureReason || execution.notes || "—",
    actualResult: execution.actualResult || "—",
    executionUrl,
  };

  const summary = render(config.summaryTemplate ?? DEFAULT_SUMMARY_TEMPLATE, vars).slice(0, 250);
  const description = render(config.descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE, vars);

  const fields: Record<string, unknown> = {
    project: { key: project.jiraProjectKey },
    summary,
    issuetype: { name: project.jiraIssueType || config.defaultIssueType || "Bug" },
    description: mdToAdf(description),
    labels: ["testsuits", "auto-created"],
  };
  if (project.jiraParentEpicKey) {
    fields.parent = { key: project.jiraParentEpicKey };
  }
  // If the tester linked their Jira identity in their profile, file the bug
  // under that accountId so Jira shows them as reporter instead of the API
  // token's service account. Missing / unlinked → Jira defaults to the token
  // owner (company-wide Jira service account).
  let reporterAccountId: string | null = reporter?.jiraAccountId ?? null;
  let reporterSource: "caller" | "historicalTester" | "tokenOwner" | "none" =
    caller ? "caller" : execution.executedBy ? "historicalTester" : "none";
  if (!reporterAccountId) {
    // Fall back to the Jira service-account user (the email used to
    // configure the Jira connection) so every ticket has a meaningful
    // reporter even when the tester hasn't linked their Jira profile.
    reporterAccountId = await getTokenOwnerAccountId(config);
    if (reporterAccountId) reporterSource = "tokenOwner";
  }
  if (reporterAccountId) fields.reporter = { accountId: reporterAccountId };

  logger.info(
    {
      executionId,
      callerUserId: callerUserId ?? null,
      reporterAccountId,
      reporterSource,
      reporterSet: !!fields.reporter,
      jiraProject: project.jiraProjectKey,
    },
    "jira bug payload (execution)",
  );

  const data = await jiraFetch<{ key: string; self: string }>(
    config,
    "/rest/api/3/issue",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) },
  );

  const issueUrl = `${config.baseUrl.replace(/\/$/, "")}/browse/${data.key}`;
  const updated = await prisma.testExecution.update({
    where: { id: executionId },
    data: { jiraIssueKey: data.key, jiraIssueUrl: issueUrl },
  });

  // Create a remote link in Jira back to the SuitesGlobal execution.
  try {
    await jiraFetch(config, `/rest/api/3/issue/${data.key}/remotelink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        globalId: `testsuits:execution:${executionId}`,
        application: { type: "com.testsuits", name: "SuitesGlobal" },
        relationship: "tested by",
        object: {
          url: executionUrl,
          title: `${execution.case.title} — ${execution.run.name}`,
          icon: { url16x16: `${appUrl}/favicon.svg`, title: "SuitesGlobal" },
        },
      }),
    });
  } catch (e) {
    // Non-fatal — the bug was created, backlink is a nice-to-have.
    logger.warn({ jiraKey: data.key, err: (e as Error).message }, "failed to create jira remote link");
  }

  logger.info(
    { executionId, jiraKey: data.key, jiraProject: project.jiraProjectKey, parentEpic: project.jiraParentEpicKey },
    "jira bug created",
  );

  try {
    const { logActivity } = await import("./activity");
    await logActivity({
      projectId: execution.case.suite.projectId,
      userId: execution.executedById ?? null,
      action: "JIRA_LINKED",
      entityType: "execution",
      entityId: executionId,
      payload: { issueKey: data.key, auto: true, parentEpic: project.jiraParentEpicKey ?? null },
    });
  } catch (err) {
    logger.warn({ err, executionId }, "failed to log activity for Jira bug creation");
  }

  return updated;
}

/**
 * Create a Jira bug for a specific failed TestExecutionResult (one combination
 * of platform × connectivity × locale). The resulting ticket is scoped to that
 * combo: summary and description reflect only the failing configuration, and
 * the jiraIssueKey / jiraIssueUrl are stored on the result row (not the parent
 * execution) so the tester can file one bug per failing cell.
 */
export async function createJiraBugForResult(resultId: string, callerUserId?: string) {
  const result = await prisma.testExecutionResult.findUnique({
    where: { id: resultId },
    include: {
      execution: {
        include: {
          case: { include: { suite: { include: { project: { include: { company: { include: { jiraConfig: true } } } } } } } },
          run: true,
        },
      },
    },
  });
  if (!result) throw httpError(404, "EXECUTION_RESULT_NOT_FOUND");
  if (result.jiraIssueKey) throw httpError(409, "JIRA_ISSUE_ALREADY_LINKED");
  if (result.status !== "FAILED") throw httpError(400, "RESULT_NOT_FAILED");
  if (!result.failureReason?.trim() || !result.actualResult?.trim()) {
    throw httpError(400, "RESULT_FAILED_REQUIRES_REASON_AND_DETAILS");
  }

  const executedBy = result.executedById
    ? await prisma.user.findUnique({
        where: { id: result.executedById },
        select: { name: true, email: true, jiraAccountId: true },
      })
    : null;
  // Reporter = caller (Create Bug click) when available, else the historical
  // tester that marked the combo FAILED.
  const caller = callerUserId
    ? await prisma.user.findUnique({
        where: { id: callerUserId },
        select: { name: true, email: true, jiraAccountId: true },
      })
    : null;
  const reporter = caller ?? executedBy;

  const execution = result.execution;
  const project = execution.case.suite.project;
  const config = project.company.jiraConfig;
  if (!config || !config.enabled) throw httpError(400, "JIRA_NOT_CONFIGURED");
  if (!project.jiraProjectKey) throw httpError(400, "JIRA_PROJECT_NOT_SET");

  const stepsText = (execution.case.steps as Array<{ action: string; expected: string }>)
    .map((s, i) => `${i + 1}. ${s.action}\n   *Expected:* ${s.expected}`)
    .join("\n");

  const executionUrl = `${appUrl}/runs/${execution.run.id}`;
  const comboLabel = [result.platform, result.connectivity, result.locale]
    .filter((v) => !!v)
    .join(" · ") || "—";

  const vars: Record<string, string> = {
    caseTitle: execution.case.title,
    suiteName: execution.case.suite.name,
    projectName: project.name,
    projectKey: project.key,
    runName: execution.run.name,
    environment: execution.run.environment ?? "—",
    platform: result.platform ?? "—",
    connectivity: result.connectivity ?? "—",
    locale: result.locale || "—",
    combo: comboLabel,
    tester: executedBy?.name ?? "unknown",
    preconditions: execution.case.preconditions || "—",
    steps: stepsText || "—",
    failureReason: result.failureReason || result.notes || "—",
    actualResult: result.actualResult || "—",
    executionUrl,
  };

  const summary = render(config.summaryTemplate ?? DEFAULT_SUMMARY_TEMPLATE, vars).slice(0, 250);
  const description = render(config.descriptionTemplate ?? DEFAULT_DESCRIPTION_TEMPLATE, vars);

  const fields: Record<string, unknown> = {
    project: { key: project.jiraProjectKey },
    summary,
    issuetype: { name: project.jiraIssueType || config.defaultIssueType || "Bug" },
    description: mdToAdf(description),
    labels: ["testsuits", "auto-created"],
  };
  if (project.jiraParentEpicKey) {
    fields.parent = { key: project.jiraParentEpicKey };
  }
  let reporterAccountId: string | null = reporter?.jiraAccountId ?? null;
  let reporterSource: "caller" | "historicalTester" | "tokenOwner" | "none" =
    caller ? "caller" : executedBy ? "historicalTester" : "none";
  if (!reporterAccountId) {
    reporterAccountId = await getTokenOwnerAccountId(config);
    if (reporterAccountId) reporterSource = "tokenOwner";
  }
  if (reporterAccountId) fields.reporter = { accountId: reporterAccountId };

  logger.info(
    {
      resultId,
      executionId: execution.id,
      callerUserId: callerUserId ?? null,
      reporterAccountId,
      reporterSource,
      reporterSet: !!fields.reporter,
      platform: result.platform,
      connectivity: result.connectivity,
      locale: result.locale,
      jiraProject: project.jiraProjectKey,
    },
    "creating jira bug for execution result",
  );

  const data = await jiraFetch<{ key: string; self: string }>(
    config,
    "/rest/api/3/issue",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) },
  );

  const issueUrl = `${config.baseUrl.replace(/\/$/, "")}/browse/${data.key}`;
  const updated = await prisma.testExecutionResult.update({
    where: { id: resultId },
    data: { jiraIssueKey: data.key, jiraIssueUrl: issueUrl },
  });

  try {
    await jiraFetch(config, `/rest/api/3/issue/${data.key}/remotelink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        globalId: `testsuits:result:${resultId}`,
        application: { type: "com.testsuits", name: "SuitesGlobal" },
        relationship: "tested by",
        object: {
          url: executionUrl,
          title: `${execution.case.title} — ${execution.run.name} (${comboLabel})`,
          icon: { url16x16: `${appUrl}/favicon.svg`, title: "SuitesGlobal" },
        },
      }),
    });
  } catch (e) {
    logger.warn({ jiraKey: data.key, err: (e as Error).message }, "failed to create jira remote link for result");
  }

  logger.info(
    {
      resultId,
      executionId: execution.id,
      jiraKey: data.key,
      combo: comboLabel,
      parentEpic: project.jiraParentEpicKey,
    },
    "jira bug created for execution result",
  );

  try {
    const { logActivity } = await import("./activity");
    await logActivity({
      projectId: execution.case.suite.projectId,
      userId: result.executedById ?? null,
      action: "JIRA_LINKED",
      entityType: "executionResult",
      entityId: resultId,
      payload: {
        issueKey: data.key,
        auto: true,
        combo: comboLabel,
        platform: result.platform,
        connectivity: result.connectivity,
        locale: result.locale || null,
        parentEpic: project.jiraParentEpicKey ?? null,
      },
    });
  } catch (err) {
    logger.warn({ err, resultId }, "failed to log activity for Jira result bug creation");
  }

  return updated;
}
