import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { AuthedRequest, requireAuth, requireManager, signChallengeToken, signToken } from "../middleware/auth";
import { httpError } from "../middleware/error";
import { logger } from "../lib/logger";
import { appUrl, sendEmail } from "../lib/mailer";
import { ensureDefaultOptions } from "../lib/testConfig";

const RESET_TTL_MS = 60 * 60 * 1000;              // 1 hour
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;    // 7 days
const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;        // 15 minutes
const TRUST_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Stable bcrypt hash used as a timing shield when login can't find the user.
// Generated once at boot for "invalid-password-but-valid-shape" so attackers
// can't infer user existence from response latency.
const TIMING_SHIELD_HASH = bcrypt.hashSync(randomBytes(16).toString("hex"), 10);

function hashToken(plaintext: string) {
  return createHash("sha256").update(plaintext).digest("hex");
}
function newRawToken() {
  return randomBytes(24).toString("base64url");
}

// Rate limits. Tight on credential-adjacent endpoints; a bit looser on read-only
// invite preview. Limits are per-IP and per-window; the reverse proxy must set
// X-Forwarded-For (see TRUST_PROXY in app.ts) for this to work at the edge.
const limiterCommon = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMIT_EXCEEDED" },
  // Integration tests hammer these endpoints from a single IP; rate-limit
  // enforcement turns test flakes into cascading 429s. Limits stay on for dev
  // and prod.
  skip: () => process.env.NODE_ENV === "test",
};
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, ...limiterCommon });
const signupLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5, ...limiterCommon });
const forgotLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5, ...limiterCommon });
const resetLimiter = rateLimit({ windowMs: 60_000, max: 10, ...limiterCommon });
const inviteLimiter = rateLimit({ windowMs: 60 * 60_000, max: 30, ...limiterCommon });
const invitePreviewLimiter = rateLimit({ windowMs: 60_000, max: 30, ...limiterCommon });
const acceptInviteLimiter = rateLimit({ windowMs: 60_000, max: 10, ...limiterCommon });
const verifyEmailLimiter = rateLimit({ windowMs: 60_000, max: 10, ...limiterCommon });
const resendVerifyLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5, ...limiterCommon });

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional().default(false),
});

// Password policy applied when a password is *set* (signup, reset, accept-invite).
// Login deliberately doesn't re-check strength — existing short passwords from
// pre-policy users should still be usable until they next reset.
const COMMON_PASSWORDS = new Set<string>([
  "password", "password1", "password123", "p@ssw0rd", "passw0rd",
  "123456", "1234567", "12345678", "123456789", "1234567890",
  "qwerty", "qwertyui", "qwertyuiop", "asdfgh", "asdfghjkl",
  "abc123", "abcd1234", "iloveyou", "letmein", "welcome",
  "admin", "admin123", "administrator", "root", "root1234",
  "monkey", "dragon", "football", "baseball", "sunshine",
  "changeme", "default", "temp1234", "hello123", "testtest",
]);

const passwordPolicy = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase()), "That password is too common. Pick a less obvious one.");

// --- Email verification helper ---------------------------------------------

async function createAndSendVerification(user: { id: string; email: string; name: string }): Promise<string> {
  const raw = newRawToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + VERIFY_EMAIL_TTL_MS),
    },
  });
  const verifyLink = `${appUrl}/verify-email/${raw}`;
  logger.info({ userId: user.id }, "email verification token issued");
  await sendEmail({
    to: user.email,
    subject: "Verify your SuitesGlobal email",
    text: `Hi ${user.name},\n\nPlease verify your email address by clicking the link below (valid for 24 hours):\n\n${verifyLink}\n\nIf you didn't create this account, you can ignore this email.\n`,
    html: `<p>Hi ${user.name},</p><p>Please verify your email address by clicking the link below (valid for 24 hours):</p><p><a href="${verifyLink}">${verifyLink}</a></p><p>If you didn't create this account, you can ignore this email.</p>`,
  });
  return raw;
}

// --- Login -----------------------------------------------------------------

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password, rememberMe } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email }, include: { company: true } });
    // Run bcrypt.compare unconditionally so response latency doesn't reveal
    // whether the email exists.
    const ok = await bcrypt.compare(password, user?.passwordHash ?? TIMING_SHIELD_HASH);

    if (!user) {
      logger.warn({ email, reason: "user_not_found" }, "login failed");
      throw httpError(401, "INVALID_CREDENTIALS");
    }

    // --- Manager-imposed lock (permanent until unlocked) ---
    if (user.isLocked) {
      logger.warn({ email, userId: user.id, reason: "account_locked_by_admin" }, "login rejected (locked by admin)");
      throw httpError(423, "ACCOUNT_LOCKED");
    }

    // --- Per-account lockout ---
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      logger.warn({ email, userId: user.id, reason: "account_locked", minutesLeft }, "login rejected (locked)");
      throw httpError(423, "ACCOUNT_TEMPORARILY_LOCKED");
    }

    if (!ok) {
      const attempts = user.failedAttempts + 1;
      const justLocked = attempts >= MAX_LOGIN_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: attempts,
          ...(justLocked ? { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) } : {}),
        },
      });
      logger.warn({ email, userId: user.id, reason: "bad_password", attempts }, "login failed");

      if (justLocked) {
        logger.warn({ userId: user.id, email, lockoutMinutes: LOCKOUT_DURATION_MS / 60_000 }, "account locked after repeated failures");
        // Fire-and-forget — lockout is already applied; don't block the response on email delivery.
        sendEmail({
          to: user.email,
          subject: "Your SuitesGlobal account has been temporarily locked",
          text: `Hi ${user.name},\n\nWe detected ${MAX_LOGIN_ATTEMPTS} consecutive failed login attempts on your account. As a precaution, your account has been locked for 15 minutes.\n\nIf this wasn't you, we recommend resetting your password:\n${appUrl}/forgot\n\nIf it was you, simply wait 15 minutes and try again.\n`,
          html: `<p>Hi ${user.name},</p><p>We detected <strong>${MAX_LOGIN_ATTEMPTS} consecutive failed login attempts</strong> on your account. As a precaution, your account has been locked for 15 minutes.</p><p>If this wasn't you, we recommend <a href="${appUrl}/forgot">resetting your password</a>.</p><p>If it was you, simply wait 15 minutes and try again.</p>`,
        }).catch((err) => logger.error({ err, userId: user.id }, "failed to send lockout notification email"));
        throw httpError(423, "ACCOUNT_TEMPORARILY_LOCKED");
      }

      throw httpError(401, "INVALID_CREDENTIALS");
    }

    // Successful login — reset lockout state and record login time.
    await prisma.user.update({
      where: { id: user.id },
      data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // Gate: email not verified yet.
    if (!user.emailVerifiedAt) {
      logger.warn({ userId: user.id, email: user.email }, "login blocked — email not verified");
      return res.status(403).json({ error: "EMAIL_NOT_VERIFIED" });
    }

    const userPayload = { id: user.id, email: user.email, role: user.role, companyId: user.companyId } as const;
    const userJson = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      jiraAccountId: user.jiraAccountId,
      jiraDisplayName: user.jiraDisplayName,
      company: { id: user.company.id, name: user.company.name, slug: user.company.slug },
    };

    // Gate: 2FA enabled — check for a trusted-device token first.
    if (user.totpEnabledAt) {
      const trustHeader = req.headers["x-trust-token"] as string | undefined;
      if (trustHeader) {
        const trusted = await prisma.trustedDevice.findFirst({
          where: { tokenHash: hashToken(trustHeader), userId: user.id, expiresAt: { gt: new Date() } },
        });
        if (trusted) {
          const token = signToken(userPayload, { rememberMe });
          logger.info({ userId: user.id }, "login succeeded — trusted device, 2FA skipped");
          return res.json({ token, user: userJson });
        }
      }
      // Not trusted — issue a short-lived challenge token.
      const challengeToken = signChallengeToken(user.id);
      logger.info({ userId: user.id }, "login paused — 2FA challenge issued");
      return res.json({ requires2fa: true, challengeToken, rememberMe });
    }

    const token = signToken(userPayload, { rememberMe });
    logger.info({ userId: user.id, email: user.email, companyId: user.companyId }, "login succeeded");
    res.json({ token, user: userJson });
  } catch (e) {
    next(e);
  }
});

const signupSchema = z.object({
  email: z.string().email(),
  password: passwordPolicy,
  name: z.string().min(1),
  companyName: z.string().min(1),
});

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "company";
}

// Public signup: creates a new Company and makes the signer its first MANAGER.
// There is no super-admin — every account lives inside exactly one company.
// The user must verify their email before they can sign in.
authRouter.post("/signup", signupLimiter, async (req, res, next) => {
  try {
    const { email, password, name, companyName } = signupSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw httpError(409, "EMAIL_ALREADY_IN_USE");

    const baseSlug = slugify(companyName);
    let slug = baseSlug;
    let n = 2;
    while (await prisma.company.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${n++}`;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const { user, company } = await prisma.$transaction(async (tx) => {
      const company = await tx.company.create({ data: { name: companyName, slug } });
      const user = await tx.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: "MANAGER",
          companyId: company.id,
          // emailVerifiedAt intentionally null — user must verify via email.
        },
      });
      await ensureDefaultOptions(company.id, tx);
      return { user, company };
    });

    logger.info({ userId: user.id, companyId: company.id, slug: company.slug }, "company signup — verification email pending");
    const devToken = await createAndSendVerification(user);
    const leak = process.env.NODE_ENV !== "production" ? { devToken } : {};
    res.status(201).json({ ok: true, ...leak });
  } catch (e) {
    next(e);
  }
});

// --- Password reset --------------------------------------------------------

const forgotSchema = z.object({ email: z.string().email() });

authRouter.post("/forgot", forgotLimiter, async (req, res, next) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    // Do NOT disclose whether the email exists. Only create a token if it does;
    // the response is always the same shape from the caller's perspective.
    let devToken: string | undefined;
    if (user) {
      const raw = newRawToken();
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      });
      devToken = raw;
      const resetLink = `${appUrl}/reset/${raw}`;
      // Never log the raw token — logs are often shipped to third-party aggregators.
      logger.info({ userId: user.id }, "password reset issued");
      await sendEmail({
        to: user.email,
        subject: "Reset your SuitesGlobal password",
        text: `Hi ${user.name},\n\nWe received a request to reset your SuitesGlobal password. The link below is valid for 1 hour:\n\n${resetLink}\n\nIf you didn't request this, you can ignore this email.\n`,
        html: `<p>Hi ${user.name},</p><p>We received a request to reset your SuitesGlobal password. The link below is valid for 1 hour:</p><p><a href="${resetLink}">${resetLink}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    } else {
      logger.info({ email }, "password reset requested for unknown email (silent)");
    }
    // The raw token is returned only in non-production so the UI can surface
    // the link without email. In production the email is the sole delivery.
    const leak = process.env.NODE_ENV !== "production" ? { devToken } : {};
    res.json({ ok: true, ...leak });
  } catch (e) {
    next(e);
  }
});

const resetSchema = z.object({
  token: z.string().min(10),
  password: passwordPolicy,
});

authRouter.post("/reset", resetLimiter, async (req, res, next) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.consumedAt || row.expiresAt < new Date()) {
      throw httpError(400, "RESET_LINK_INVALID");
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date();
    await prisma.$transaction([
      // passwordUpdatedAt invalidates any outstanding JWT for this user (see
      // requireAuth). Deleting ApiTokens invalidates CI/script credentials
      // that may have been leaked alongside the password.
      prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash, passwordUpdatedAt: now, failedAttempts: 0, lockedUntil: null },
      }),
      prisma.apiToken.deleteMany({ where: { userId: row.userId } }),
      prisma.trustedDevice.deleteMany({ where: { userId: row.userId } }),
      prisma.passwordResetToken.update({ where: { id: row.id }, data: { consumedAt: now } }),
      // Any other outstanding reset tokens for this user become unusable.
      prisma.passwordResetToken.updateMany({
        where: { userId: row.userId, consumedAt: null, id: { not: row.id } },
        data: { consumedAt: now },
      }),
    ]);
    logger.info({ userId: row.userId }, "password reset consumed; JWT + API tokens revoked");
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// --- Email verification ----------------------------------------------------

const verifyEmailSchema = z.object({ token: z.string().min(10) });

authRouter.post("/verify-email", verifyEmailLimiter, async (req, res, next) => {
  try {
    const { token } = verifyEmailSchema.parse(req.body);
    const row = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { company: true } } },
    });
    if (!row || row.consumedAt || row.expiresAt < new Date()) {
      throw httpError(400, "VERIFICATION_LINK_INVALID");
    }
    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: row.userId },
        data: { emailVerifiedAt: now },
      }),
      prisma.emailVerificationToken.update({
        where: { id: row.id },
        data: { consumedAt: now },
      }),
      // Consume all other outstanding verification tokens for this user.
      prisma.emailVerificationToken.updateMany({
        where: { userId: row.userId, consumedAt: null, id: { not: row.id } },
        data: { consumedAt: now },
      }),
    ]);
    const jwt = signToken({
      id: row.user.id,
      email: row.user.email,
      role: row.user.role,
      companyId: row.user.companyId,
    });
    logger.info({ userId: row.userId }, "email verified");
    res.json({
      token: jwt,
      user: {
        id: row.user.id,
        email: row.user.email,
        name: row.user.name,
        role: row.user.role,
        jiraAccountId: row.user.jiraAccountId,
        jiraDisplayName: row.user.jiraDisplayName,
        company: { id: row.user.company.id, name: row.user.company.name, slug: row.user.company.slug },
      },
    });
  } catch (e) {
    next(e);
  }
});

const resendVerifySchema = z.object({ email: z.string().email() });

authRouter.post("/resend-verification", resendVerifyLimiter, async (req, res, next) => {
  try {
    const { email } = resendVerifySchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    let devToken: string | undefined;
    if (user && !user.emailVerifiedAt) {
      // Invalidate previous verification tokens.
      await prisma.emailVerificationToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      devToken = await createAndSendVerification(user);
      logger.info({ userId: user.id }, "verification email resent");
    } else {
      logger.info({ email }, "resend-verification for unknown/already-verified email (silent)");
    }
    const leak = process.env.NODE_ENV !== "production" ? { devToken } : {};
    res.json({ ok: true, ...leak });
  } catch (e) {
    next(e);
  }
});

// --- Team invite -----------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  role: z.enum(["ADMIN", "MANAGER", "TESTER", "VIEWER"]),
});

authRouter.post("/invite", inviteLimiter, requireAuth, requireManager, async (req: AuthedRequest, res, next) => {
  try {
    const { email, name, role } = inviteSchema.parse(req.body);
    // Refuse if this email is already a user in ANY company — email is a global unique in User.
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) throw httpError(409, "EMAIL_ALREADY_IN_USE");

    // Invalidate previous un-consumed invites for the same email within this company.
    await prisma.inviteToken.deleteMany({
      where: { companyId: req.user!.companyId, email, acceptedAt: null },
    });

    const raw = newRawToken();
    const invite = await prisma.inviteToken.create({
      data: {
        companyId: req.user!.companyId,
        email,
        name,
        role,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: req.user!.id,
      },
      select: { id: true, email: true, name: true, role: true, expiresAt: true },
    });
    const inviteLink = `${appUrl}/invite/${raw}`;
    // Never log the raw token — logs are often shipped to third-party aggregators.
    logger.info({ inviteId: invite.id, email }, "invite issued");
    await sendEmail({
      to: email,
      subject: `You've been invited to join SuitesGlobal`,
      text: `Hi ${name},\n\n${req.user!.email} invited you to join their SuitesGlobal workspace as a ${role}. Accept the invite here (valid for 7 days):\n\n${inviteLink}\n`,
      html: `<p>Hi ${name},</p><p>${req.user!.email} invited you to join their SuitesGlobal workspace as a <strong>${role}</strong>. Accept the invite here (valid for 7 days):</p><p><a href="${inviteLink}">${inviteLink}</a></p>`,
    });
    const leak = process.env.NODE_ENV !== "production" ? { devToken: raw } : {};
    res.status(201).json({ ...invite, ...leak });
  } catch (e) {
    next(e);
  }
});

authRouter.get("/invite/:token", invitePreviewLimiter, async (req, res, next) => {
  try {
    const row = await prisma.inviteToken.findUnique({
      where: { tokenHash: hashToken(req.params.token) },
      include: { company: true },
    });
    if (!row || row.acceptedAt || row.expiresAt < new Date()) {
      throw httpError(404, "INVITE_INVALID");
    }
    res.json({
      email: row.email,
      name: row.name,
      role: row.role,
      company: { id: row.company.id, name: row.company.name, slug: row.company.slug },
    });
  } catch (e) {
    next(e);
  }
});

const acceptSchema = z.object({
  token: z.string().min(10),
  password: passwordPolicy,
});

authRouter.post("/accept-invite", acceptInviteLimiter, async (req, res, next) => {
  try {
    const { token, password } = acceptSchema.parse(req.body);
    const row = await prisma.inviteToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { company: true },
    });
    if (!row || row.acceptedAt || row.expiresAt < new Date()) {
      throw httpError(400, "INVITE_INVALID");
    }
    // Race-safety: someone may have signed up with this email in the meantime.
    const existingUser = await prisma.user.findUnique({ where: { email: row.email } });
    if (existingUser) throw httpError(409, "EMAIL_ALREADY_IN_USE");

    const passwordHash = await bcrypt.hash(password, 10);
    const { user } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: row.email,
          name: row.name,
          passwordHash,
          role: row.role,
          companyId: row.companyId,
          emailVerifiedAt: new Date(), // Clicking the invite link proves email ownership.
        },
      });
      await tx.inviteToken.update({ where: { id: row.id }, data: { acceptedAt: new Date() } });
      return { user };
    });

    const jwt = signToken({ id: user.id, email: user.email, role: user.role, companyId: user.companyId });
    logger.info({ userId: user.id, companyId: user.companyId, inviteId: row.id }, "invite accepted");
    res.status(201).json({
      token: jwt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        company: { id: row.company.id, name: row.company.name, slug: row.company.slug },
      },
    });
  } catch (e) {
    next(e);
  }
});
