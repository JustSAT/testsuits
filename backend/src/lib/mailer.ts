import nodemailer, { Transporter } from "nodemailer";
import { logger } from "./logger";

const gmailUser = process.env.GMAIL_USER?.trim();
const gmailPassword = process.env.GMAIL_PASSWORD?.trim();
const smtpUrl = process.env.SMTP_URL;
const from =
  process.env.MAIL_FROM ??
  (gmailUser ? `SuitesGlobal <${gmailUser}>` : "SuitesGlobal <no-reply@suitesglobal.local>");
export const appUrl = process.env.APP_URL ?? "http://localhost:5173";

// Microsoft Graph sendMail as one Microsoft 365 mailbox, with an Entra app's
// client-credentials token (the same setup the RMCflow website uses). Graph
// sends as the mailbox itself, so MAIL_FROM does not apply on this path.
const graph = {
  tenantId: process.env.GRAPH_TENANT_ID?.trim(),
  clientId: process.env.GRAPH_CLIENT_ID?.trim(),
  clientSecret: process.env.GRAPH_CLIENT_SECRET?.trim(),
  sender: process.env.GRAPH_SENDER?.trim(),
};
const useGraph = !!(graph.tenantId && graph.clientId && graph.clientSecret && graph.sender);

let transporter: Transporter | null = null;
if (useGraph) {
  logger.info({ sender: graph.sender }, "mailer initialised (Microsoft Graph)");
} else if (gmailUser && gmailPassword) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPassword },
  });
  logger.info({ gmailUser }, "mailer initialised (Gmail)");
} else if (smtpUrl) {
  transporter = nodemailer.createTransport(smtpUrl);
  logger.info({ smtpUrl: smtpUrl.replace(/\/\/[^@]*@/, "//***@") }, "mailer initialised (SMTP)");
} else {
  logger.warn("No mail transport configured — outgoing email will be logged only, not sent");
}

export type Mail = { to: string; subject: string; text: string; html?: string };

let graphToken: { value: string; expiresAt: number } | null = null;

async function graphAccessToken(): Promise<string> {
  if (graphToken && graphToken.expiresAt > Date.now()) return graphToken.value;
  const res = await fetch(`https://login.microsoftonline.com/${graph.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: graph.clientId!,
      client_secret: graph.clientSecret!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`graph token ${res.status}: ${await res.text()}`);
  const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
  // Renew a minute early so a token never expires mid-request.
  graphToken = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

async function sendViaGraph(mail: Mail): Promise<void> {
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(graph.sender!)}/sendMail`, {
    method: "POST",
    headers: { authorization: `Bearer ${await graphAccessToken()}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: mail.subject,
        body: mail.html ? { contentType: "HTML", content: mail.html } : { contentType: "Text", content: mail.text },
        toRecipients: [{ emailAddress: { address: mail.to } }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) throw new Error(`graph sendMail ${res.status}: ${await res.text()}`);
}

export async function sendEmail(mail: Mail): Promise<void> {
  if (useGraph) {
    try {
      await sendViaGraph(mail);
      logger.info({ to: mail.to, subject: mail.subject, transport: "graph" }, "email sent");
    } catch (e: any) {
      logger.error({ err: e.message, to: mail.to, subject: mail.subject, transport: "graph" }, "email send failed");
    }
    return;
  }
  if (!transporter) {
    logger.info({ to: mail.to, subject: mail.subject, preview: mail.text.slice(0, 200) }, "email not sent (no SMTP)");
    return;
  }
  try {
    const info = await transporter.sendMail({ from, ...mail });
    logger.info({ to: mail.to, subject: mail.subject, messageId: info.messageId }, "email sent");
  } catch (e: any) {
    logger.error({ err: e.message, to: mail.to, subject: mail.subject }, "email send failed");
  }
}
