import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { z, ZodError } from "zod";
import { errorHandler, httpError } from "../../middleware/error";

function mockReq() {
  const log = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  const req = { log } as unknown as Request & { log: typeof log };
  return { req, log };
}

function mockRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("httpError", () => {
  it("creates an Error with the given status attached", () => {
    const e = httpError(404, "PROJECT_NOT_FOUND");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(404);
    expect(e.message).toBe("PROJECT_NOT_FOUND");
  });
});

describe("errorHandler", () => {
  it("flattens a ZodError into a 400 VALIDATION_FAILED response", () => {
    const { req, log } = mockReq();
    const res = mockRes();
    let zErr: ZodError;
    try {
      z.object({ email: z.string().email() }).parse({ email: "nope" });
      throw new Error("schema should have rejected");
    } catch (e) {
      zErr = e as ZodError;
    }
    errorHandler(zErr, req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error).toBe("VALIDATION_FAILED");
    expect(body.details.fieldErrors.email).toBeDefined();
    expect(log.warn).toHaveBeenCalled();
  });

  it("returns a 4xx Error with its status and logs as warn", () => {
    const { req, log } = mockReq();
    const res = mockRes();
    errorHandler(httpError(404, "PROJECT_NOT_FOUND"), req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "PROJECT_NOT_FOUND" });
    expect(log.warn).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("returns a 500 for an Error without a status, without leaking its message, and logs as error", () => {
    const { req, log } = mockReq();
    const res = mockRes();
    errorHandler(new Error("boom"), req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    // Raw exception text (Prisma, drivers, SDKs) never reaches the client.
    expect(res.json).toHaveBeenCalledWith({ error: "INTERNAL_SERVER_ERROR" });
    expect(log.error).toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("returns a 500 and a generic code when a non-Error is thrown", () => {
    const { req, log } = mockReq();
    const res = mockRes();
    errorHandler("just a string", req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "INTERNAL_SERVER_ERROR" });
    expect(log.error).toHaveBeenCalled();
  });

  it("logs an Error with status >= 500 at error level", () => {
    const { req, log } = mockReq();
    const res = mockRes();
    errorHandler(httpError(503, "DB_DOWN"), req, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
    expect(log.error).toHaveBeenCalled();
  });
});
