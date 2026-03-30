import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { signToken, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;

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

  const [existingUsername] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, normalizedUsername))
    .limit(1);
  if (existingUsername) {
    res.status(409).json({ error: "That username is already taken" });
    return;
  }

  let normalizedEmail: string | null = null;
  if (email && email.trim()) {
    normalizedEmail = email.trim().toLowerCase();
    const [existingEmail] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, normalizedEmail))
      .limit(1);
    if (existingEmail) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }
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

  if (!user) {
    res.status(401).json({ error: "Invalid username/email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
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

export default router;
