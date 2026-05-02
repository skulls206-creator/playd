import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";

function requireJwtSecret(): string {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error("JWT_SECRET environment variable is required but not set. Set it as a secret before starting the server.");
  }
  return value;
}
const JWT_SECRET: string = requireJwtSecret();
const JWT_EXPIRES_IN = "30d";
const STREAM_TOKEN_EXPIRES_IN = "5m";

export interface AuthPayload {
  userId: number;
  email?: string;
}

interface FullAuthPayload extends AuthPayload {
  scope?: "stream";
  resource?: string;
}

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      userEmail?: string;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): FullAuthPayload {
  return jwt.verify(token, JWT_SECRET) as FullAuthPayload;
}

/**
 * Issue a short-lived, stream-scoped token bound to a single resource id
 * (e.g. `yt:dQw4w9WgXcQ` or `subsonic:42:track-id`). Tokens carry a
 * `scope: "stream"` claim, the `resource` they authorise, and a 5-minute
 * lifetime. This means a leaked stream URL can only be replayed against
 * that one resource and only for a few minutes — never against normal APIs
 * (which require `requireAuth`, which rejects stream-scoped tokens).
 */
export function signStreamToken(payload: AuthPayload, resource: string): string {
  return jwt.sign({ ...payload, scope: "stream", resource }, JWT_SECRET, { expiresIn: STREAM_TOKEN_EXPIRES_IN });
}

/**
 * Standard authentication for normal APIs. Rejects stream-scoped tokens.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  try {
    const payload = verifyToken(token);
    if (payload.scope === "stream") {
      res.status(401).json({ error: "Stream tokens are not accepted on this endpoint" });
      return;
    }
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Auth middleware factory for audio streaming routes the browser consumes
 * via `<audio src>` (no custom headers possible). Accepts ONLY short-lived
 * stream-scoped tokens (`POST /api/auth/stream-token`) whose `resource`
 * claim matches the resource computed from the request via
 * `getExpectedResource(req)`.
 *
 * Tokens may be supplied via `Authorization: Bearer ...` or, on GET
 * requests only, the `?token=` query parameter.
 */
export function requireStreamAuth(getExpectedResource: (req: Request) => string | null): RequestHandler {
  return (req, res, next) => {
    let token: string | null = null;

    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      token = auth.slice(7);
    } else if (req.method === "GET" && typeof req.query.token === "string") {
      token = req.query.token;
    }

    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    let payload: FullAuthPayload;
    try {
      payload = verifyToken(token);
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    if (payload.scope !== "stream") {
      res.status(401).json({ error: "A stream-scoped token is required" });
      return;
    }

    const expected = getExpectedResource(req);
    if (!expected || payload.resource !== expected) {
      res.status(401).json({ error: "Stream token does not authorise this resource" });
      return;
    }

    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  };
}
