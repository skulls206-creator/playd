import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { signToken, signStreamToken, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;

// Pre-computed bcrypt hash used to keep login timing constant when the
// supplied identifier does not match any user. Generated once at startup so
// that bcrypt.compare() always performs real work, preventing a timing-based
// account enumeration oracle.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("dummy-password-for-timing-parity", 12);

router.post("/auth/register", async (req, res): Promise<void> => {
  const { username, password, email, displayName } = req.body as {
    username?: string;
    password?: string;
    email?: string;
    displayName?: string;
  };

  if (!username || !password) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  if (!USERNAME_RE.test(username)) {
    res.status(400).json({ error: "Username must be 3–30 characters: letters, numbers, . _ -" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const normalizedUsername = username.trim().toLowerCase();

  let normalizedEmail: string | null = null;
  if (email && email.trim()) {
    normalizedEmail = email.trim().toLowerCase();
  }

  // Look up username and (if provided) email collisions in a single query so
  // we can return a uniform error message that does not leak which identifier
  // is already registered (no account-enumeration oracle).
  const collisions = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      normalizedEmail
        ? or(eq(usersTable.username, normalizedUsername), eq(usersTable.email, normalizedEmail))
        : eq(usersTable.username, normalizedUsername),
    )
    .limit(1);
  if (collisions.length > 0) {
    res.status(409).json({ error: "Username or email is already in use" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
      displayName: displayName?.trim() || null,
    })
    .returning({
      id: usersTable.id,
      username: usersTable.username,
      email: usersTable.email,
      displayName: usersTable.displayName,
      createdAt: usersTable.createdAt,
    });

  const token = signToken({ userId: user.id });
  res.status(201).json({ token, user });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { identifier, password } = req.body as { identifier?: string; password?: string };

  if (!identifier || !password) {
    res.status(400).json({ error: "Username/email and password are required" });
    return;
  }

  const normalized = identifier.trim().toLowerCase();
  const isEmail = normalized.includes("@");

  const [user] = await db
    .select()
    .from(usersTable)
    .where(isEmail ? eq(usersTable.email, normalized) : eq(usersTable.username, normalized))
    .limit(1);

  // Always run bcrypt to prevent timing-based account enumeration.
  const valid = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_PASSWORD_HASH);

  if (!user || !valid) {
    res.status(401).json({ error: "Invalid username/email or password" });
    return;
  }

  const token = signToken({ userId: user.id });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    },
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      email: usersTable.email,
      displayName: usersTable.displayName,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json({ user });
});

router.post("/auth/logout", (_req, res): void => {
  res.sendStatus(200);
});

/**
 * Issue a short-lived, stream-scoped token bound to a single resource for
 * audio stream URLs the browser consumes via `<audio src>` (where custom
 * headers are not possible). Requires a regular account session and a
 * `resource` body field naming the specific stream the token authorises.
 */
const STREAM_RESOURCE_RE = /^[a-zA-Z]{2,16}:[A-Za-z0-9._:/+=-]{1,256}$/;
router.post("/auth/stream-token", requireAuth, (req, res): void => {
  const { resource } = req.body as { resource?: string };
  if (!resource || typeof resource !== "string" || !STREAM_RESOURCE_RE.test(resource)) {
    res.status(400).json({ error: "resource is required (e.g. 'yt:<videoId>' or 'subsonic:<serverId>:<trackId>')" });
    return;
  }
  const token = signStreamToken({ userId: req.userId!, email: req.userEmail }, resource);
  res.json({ token, expiresIn: 300 });
});

export default router;
