import { Router, type IRouter } from "express";
import { eq, asc, and } from "drizzle-orm";
import { db, queuedTracksTable, tracksTable } from "@workspace/db";
import {
  ReplaceQueueBody,
  AddToQueueBody,
  RemoveFromQueueParams,
  GetQueueResponse,
  ReplaceQueueResponse,
  AddToQueueResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

async function getFullQueue(userId: number) {
  const rows = await db
    .select({ queued: queuedTracksTable, track: tracksTable })
    .from(queuedTracksTable)
    .innerJoin(tracksTable, and(eq(tracksTable.id, queuedTracksTable.trackId), eq(tracksTable.userId, userId)))
    .where(eq(queuedTracksTable.userId, userId))
    .orderBy(asc(queuedTracksTable.position));

  return rows.map((r) => ({ ...r.queued, track: r.track }));
}

router.get("/queue", requireAuth, async (req, res): Promise<void> => {
  const queue = await getFullQueue(req.userId!);
  res.json(GetQueueResponse.parse(queue));
});

router.put("/queue", requireAuth, async (req, res): Promise<void> => {
  const parsed = ReplaceQueueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.userId!;

  await db.delete(queuedTracksTable).where(eq(queuedTracksTable.userId, userId));

  if (parsed.data.trackIds.length > 0) {
    await db.insert(queuedTracksTable).values(
      parsed.data.trackIds.map((trackId, i) => ({ trackId, position: i, userId }))
    );
  }

  const queue = await getFullQueue(userId);
  res.json(ReplaceQueueResponse.parse(queue));
});

router.post("/queue", requireAuth, async (req, res): Promise<void> => {
  const parsed = AddToQueueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.userId!;

  const existing = await db.select().from(queuedTracksTable).where(eq(queuedTracksTable.userId, userId)).orderBy(asc(queuedTracksTable.position));
  const nextPos = existing.length;

  await db.insert(queuedTracksTable).values(
    parsed.data.trackIds.map((trackId, i) => ({ trackId, position: nextPos + i, userId }))
  );

  const queue = await getFullQueue(userId);
  res.json(AddToQueueResponse.parse(queue));
});

router.delete("/queue", requireAuth, async (req, res): Promise<void> => {
  await db.delete(queuedTracksTable).where(eq(queuedTracksTable.userId, req.userId!));
  res.sendStatus(204);
});

router.delete("/queue/:id", requireAuth, async (req, res): Promise<void> => {
  const params = RemoveFromQueueParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(queuedTracksTable).where(and(eq(queuedTracksTable.id, params.data.id), eq(queuedTracksTable.userId, req.userId!)));
  res.sendStatus(204);
});

export default router;
