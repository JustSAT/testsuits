import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { prisma } from "../db";
import { AuthedRequest, signToken, verifyChallengeToken } from "../middleware/auth";
import { httpError } from "../middleware/error";
import { logger } from "../lib/logger";

const TRUST_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(plaintext: string) {
  return createHash("sha256").update(plaintext).digest("hex");
}

const limiterCommon = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMIT_EXCEEDED" },
};
const setupLimiter = rateLimit({ windowMs: 60_000, max: 10, ...limiterCommon });
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, ...limiterCommon });

export const twoFactorRouter = Router();

// --- Status (GET /2fa/status) ----------------------------------------------

twoFactorRouter.get("/status", async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { totpEnabledAt: true },
    });
    res.json({ enabled: !!user.totpEnabledAt, enabledAt: user.totpEnabledAt });
  } catch (e) { next(e); }
});

// --- Setup (POST /2fa/setup) -----------------------------------------------
// Generates a new TOTP secret and returns the otpauth URI + QR code data URL.
// The secret is NOT persisted until /confirm-setup succeeds.

twoFactorRouter.post("/setup", setupLimiter, async (req: AuthedRequest, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { totpEnabledAt: true, email: true },
    });
    if (user.totpEnabledAt) throw httpError(409, "TWO_FA_ALREADY_ENABLED");

    const secret = generateSecret();
    const otpauthUri = generateURI({ issuer: "SuitesGlobal", label: user.email, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);

    // Store the secret temporarily so confirm-setup can verify a code against it.
    // totpEnabledAt stays null until confirmation succeeds.
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { totpSecret: secret },
    });

    logger.info({ userId: req.user!.id }, "2fa setup initiated");
    res.json({ secret, otpauthUri, qrDataUrl });
  } catch (e) { next(e); }
});

// --- Confirm setup (POST /2fa/confirm-setup) --------------------------------
// Verifies a TOTP code against the pending secret and enables 2FA.

const confirmSchema = z.object({ code: z.string().length(6) });

twoFactorRouter.post("/confirm-setup", setupLimiter, async (req: AuthedRequest, res, next) => {
  try {
    const { code } = confirmSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { totpSecret: true, totpEnabledAt: true },
    });
    if (user.totpEnabledAt) throw httpError(409, "TWO_FA_ALREADY_ENABLED");
    if (!user.totpSecret) throw httpError(400, "TWO_FA_SETUP_NOT_STARTED");

    const valid = verifySync({ secret: user.totpSecret, token: code }).valid;
    if (!valid) throw httpError(400, "TWO_FA_INVALID_CODE");

    await prisma.user.update({
      where: { id: req.user!.id },
      data: { totpEnabledAt: new Date() },
    });

    logger.info({ userId: req.user!.id }, "2fa enabled");
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Disable (POST /2fa/disable) -------------------------------------------
// Requires current password for safety.

const disableSchema = z.object({ password: z.string().min(1) });

twoFactorRouter.post("/disable", setupLimiter, async (req: AuthedRequest, res, next) => {
  try {
    const { password } = disableSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { passwordHash: true, totpEnabledAt: true },
    });
    if (!user.totpEnabledAt) throw httpError(400, "TWO_FA_NOT_ENABLED");

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw httpError(401, "INCORRECT_PASSWORD");

    await prisma.$transaction([
      prisma.user.update({
        where: { id: req.user!.id },
        data: { totpSecret: null, totpEnabledAt: null },
      }),
      prisma.trustedDevice.deleteMany({ where: { userId: req.user!.id } }),
    ]);

    logger.info({ userId: req.user!.id }, "2fa disabled — trusted devices revoked");
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --- Authenticate (POST /2fa/authenticate) ---------------------------------
// Public endpoint. Consumes a challenge token + TOTP code and returns a
// full session JWT. Called from the login flow when 2FA is required.

const authenticateSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().length(6),
  trustDevice: z.boolean().optional().default(false),
  rememberMe: z.boolean().optional().default(false),
});

twoFactorRouter.post("/authenticate", authLimiter, async (req, res, next) => {
  try {
    const { challengeToken, code, trustDevice, rememberMe } = authenticateSchema.parse(req.body);

    let userId: string;
    try {
      userId = verifyChallengeToken(challengeToken);
    } catch {
      throw httpError(401, "CHALLENGE_TOKEN_INVALID");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { company: true },
    });
    if (!user || !user.totpEnabledAt || !user.totpSecret) {
      throw httpError(400, "TWO_FA_NOT_ENABLED");
    }

    const valid = verifySync({ secret: user.totpSecret, token: code }).valid;
    if (!valid) throw httpError(401, "TWO_FA_INVALID_CODE");

    // Issue a trusted-device token so this device can skip 2FA for 30 days.
    let trustToken: string | undefined;
    if (trustDevice) {
      const raw = "td_" + randomBytes(32).toString("base64url");
      await prisma.trustedDevice.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + TRUST_DEVICE_TTL_MS),
        },
      });
      trustToken = raw;
      logger.info({ userId: user.id }, "trusted device token issued (30d)");
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
    }, { rememberMe });
    logger.info({ userId: user.id }, "2fa authentication succeeded");
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        jiraAccountId: user.jiraAccountId,
        jiraDisplayName: user.jiraDisplayName,
        company: { id: user.company.id, name: user.company.name, slug: user.company.slug },
      },
      ...(trustToken ? { trustToken } : {}),
    });
  } catch (e) { next(e); }
});
