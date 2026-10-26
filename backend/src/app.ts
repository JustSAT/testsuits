import express from "express";
import cors from "cors";
import { authRouter } from "./routes/auth";
import { projectsRouter } from "./routes/projects";
import { suitesRouter } from "./routes/suites";
import { casesRouter } from "./routes/cases";
import { runsRouter } from "./routes/runs";
import { executionsRouter } from "./routes/executions";
import { executionResultsRouter } from "./routes/executionResults";
import { attachmentsRouter } from "./routes/attachments";
import { dashboardRouter } from "./routes/dashboard";
import { jiraRouter } from "./routes/jira";
import { milestonesRouter } from "./routes/milestones";
import { commentsRouter } from "./routes/comments";
import { usersRouter } from "./routes/users";
import { activityRouter } from "./routes/activity";
import { matrixRouter } from "./routes/matrix";
import { companiesRouter } from "./routes/companies";
import { environmentsRouter } from "./routes/environments";
import { testConfigOptionsRouter } from "./routes/testConfigOptions";
import { sharedStepsRouter } from "./routes/sharedSteps";
import { webhooksRouter } from "./routes/webhooks";
import { tokensRouter } from "./routes/tokens";
import { requirementsRouter } from "./routes/requirements";
import { importsRouter } from "./routes/imports";
import { clientLogRouter } from "./routes/clientLog";
import { samlRouter } from "./routes/saml";
import { scimRouter, scimTokensRouter } from "./routes/scim";
import { auditRouter } from "./routes/audit";
import { twoFactorRouter } from "./routes/twoFactor";
import { errorHandler } from "./middleware/error";
import { requireAuth, requireManager } from "./middleware/auth";
import { httpLogger } from "./middleware/logging";

export const app = express();

// When deployed behind a reverse proxy (nginx, Caddy, a cloud LB, ...) the
// real client IP lives in X-Forwarded-For. Without this, every request looks
// like it comes from the proxy's IP and rate limits hit everyone at once.
// Set TRUST_PROXY=1 (one hop) or a comma-separated list of trusted IPs in prod.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  app.set("trust proxy", /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
}

app.use(httpLogger);

// CORS: comma-separated allowlist of origins the browser may call from. An
// empty list in development falls back to reflecting the Origin header (dev
// convenience); in production an empty list means no cross-origin access.
const corsAllowList = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    exposedHeaders: ["x-request-id"],
    credentials: false,
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin / curl / server-to-server
      if (corsAllowList.length === 0) {
        if (process.env.NODE_ENV !== "production") return cb(null, true);
        return cb(null, false);
      }
      cb(null, corsAllowList.includes(origin));
    },
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Unauthenticated: the frontend logger posts here via navigator.sendBeacon
// when window.onerror / unhandledrejection fires — no JWT available at that
// point. Rate-limited per IP inside the router.
app.use("/api/_client-log", clientLogRouter);

app.use("/api/auth", authRouter);
app.use("/api/projects", requireAuth, projectsRouter);
app.use("/api/suites", requireAuth, suitesRouter);
app.use("/api/cases", requireAuth, casesRouter);
app.use("/api/runs", requireAuth, runsRouter);
app.use("/api/executions", requireAuth, executionsRouter);
app.use("/api/execution-results", requireAuth, executionResultsRouter);
app.use("/api/attachments", requireAuth, attachmentsRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/jira", requireAuth, jiraRouter);
app.use("/api/milestones", requireAuth, milestonesRouter);
app.use("/api/comments", requireAuth, commentsRouter);
app.use("/api/users", requireAuth, usersRouter);
app.use("/api/activity", requireAuth, activityRouter);
app.use("/api/matrix", requireAuth, matrixRouter);
app.use("/api/companies", requireAuth, companiesRouter);
app.use("/api/environments", requireAuth, environmentsRouter);
app.use("/api/test-config-options", requireAuth, testConfigOptionsRouter);
app.use("/api/shared-steps", requireAuth, sharedStepsRouter);
app.use("/api/webhooks", requireAuth, webhooksRouter);
app.use("/api/tokens", requireAuth, requireManager, tokensRouter);
app.use("/api/requirements", requireAuth, requirementsRouter);
app.use("/api/imports", requireAuth, importsRouter);
app.use("/api/audit", requireAuth, auditRouter);
app.use("/api/saml", (req, _res, next) => {
  // Config routes require auth; /login and /acs are public (IdP-facing).
  if (req.path.startsWith("/config")) return requireAuth(req as any, _res, next);
  return next();
}, samlRouter);
app.use("/api/2fa", (req, _res, next) => {
  // /authenticate is public (uses challenge token); all other routes require auth.
  if (req.path === "/authenticate") return next();
  return requireAuth(req as any, _res, next);
}, twoFactorRouter);
app.use("/api/scim-tokens", requireAuth, scimTokensRouter);
app.use("/api/scim", scimRouter); // Uses its own Bearer-token auth

app.use(errorHandler);
