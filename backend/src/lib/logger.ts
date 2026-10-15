import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  base: {
    service: "testsuits-api",
    env: process.env.NODE_ENV ?? "development",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Any field path that might carry a credential, secret, or raw token goes
  // here. When you add a new secret-bearing field to a model or request body,
  // add it below — this is the guarantee behind CLAUDE.md rule 1.
  //
  // `*.xxx` matches at any single level; `*.*.xxx` is a separate pattern that
  // pino requires if the field sits two levels deep (e.g. a nested Prisma
  // include). We add both where practical so token-bearing rows can't leak
  // through an accidental `logger.info({ row })`.
  redact: {
    paths: [
      // Auth transport
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      // Passwords and JWTs
      "*.password",
      "*.passwordHash",
      "*.jwt",
      // Raw tokens (one level)
      "*.token",
      "*.apiToken",
      "*.devToken",
      "*.tokenHash",
      "*.resetToken",
      "*.inviteToken",
      "*.scimToken",
      // Raw tokens (two levels deep — Prisma includes, response envelopes)
      "*.*.token",
      "*.*.apiToken",
      "*.*.tokenHash",
      "*.*.devToken",
      // Webhook HMAC signing secrets
      "*.secret",
      "*.signingSecret",
      "*.*.secret",
      // Microsoft Graph (Entra app) mailer credential
      "*.clientSecret",
      // SAML / SSO
      "*.privateKey",
      "*.certificate",
      "*.cert",
      "*.clientSecret",
      // Jira / other external API creds that might sneak into a payload dump
      "*.apiKey",
      "*.accessKey",
      "*.secretKey",
      // Gmail / SMTP credentials
      "*.gmailPassword",
      "*.pass",
    ],
    censor: "[REDACTED]",
  },
  transport: isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
      },
});
