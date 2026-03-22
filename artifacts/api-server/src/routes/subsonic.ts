import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, subsonicServersTable } from "@workspace/db";
import {
  CreateSubsonicServerBody,
  UpdateSubsonicServerBody,
  UpdateSubsonicServerParams,
  DeleteSubsonicServerParams,
  TestSubsonicServerParams,
  ListSubsonicServersResponse,
  UpdateSubsonicServerResponse,
  TestSubsonicServerResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function toPublic(server: typeof subsonicServersTable.$inferSelect) {
  const { password: _pw, ...rest } = server;
  return rest;
}

router.get("/subsonic-servers", async (_req, res): Promise<void> => {
  const servers = await db.select().from(subsonicServersTable).orderBy(subsonicServersTable.createdAt);
  res.json(ListSubsonicServersResponse.parse(servers.map(toPublic)));
});

router.post("/subsonic-servers", async (req, res): Promise<void> => {
  const parsed = CreateSubsonicServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [server] = await db.insert(subsonicServersTable).values(parsed.data).returning();
  res.status(201).json(toPublic(server));
});

router.patch("/subsonic-servers/:id", async (req, res): Promise<void> => {
  const params = UpdateSubsonicServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSubsonicServerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [server] = await db
    .update(subsonicServersTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(subsonicServersTable.id, params.data.id))
    .returning();
  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }
  res.json(UpdateSubsonicServerResponse.parse(toPublic(server)));
});

router.delete("/subsonic-servers/:id", async (req, res): Promise<void> => {
  const params = DeleteSubsonicServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(subsonicServersTable).where(eq(subsonicServersTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/subsonic-servers/:id/test", async (req, res): Promise<void> => {
  const params = TestSubsonicServerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [server] = await db
    .select()
    .from(subsonicServersTable)
    .where(eq(subsonicServersTable.id, params.data.id));

  if (!server) {
    res.status(404).json({ error: "Server not found" });
    return;
  }

  try {
    const token = Buffer.from(`${server.username}:${server.password}`).toString("base64");
    const pingUrl = `${server.url.replace(/\/$/, "")}/rest/ping.view?v=1.16.1&c=audioplayer&f=json&u=${encodeURIComponent(server.username)}&p=${encodeURIComponent(server.password)}`;

    const response = await fetch(pingUrl, {
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      res.json(TestSubsonicServerResponse.parse({ success: false, message: `HTTP ${response.status}`, version: null }));
      return;
    }

    const data = await response.json() as { "subsonic-response"?: { status?: string; version?: string; error?: { message?: string } } };
    const subResponse = data["subsonic-response"];

    if (subResponse?.status === "ok") {
      res.json(TestSubsonicServerResponse.parse({ success: true, message: "Connected successfully", version: subResponse.version ?? null }));
    } else {
      const errMsg = subResponse?.error?.message ?? "Unknown error";
      res.json(TestSubsonicServerResponse.parse({ success: false, message: errMsg, version: null }));
    }
  } catch (err) {
    logger.error({ err }, "Subsonic test failed");
    res.json(TestSubsonicServerResponse.parse({ success: false, message: "Connection failed", version: null }));
  }
});

export default router;
