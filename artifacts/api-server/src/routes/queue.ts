import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, queuedTracksTable, tracksTable } from "@workspace/db";
import {
  ReplaceQueueBody,
  AddToQueueBody,
  RemoveFromQueueParams,
  GetQueueResponse,
  ReplaceQueueResponse,
  AddToQueueResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getFullQueue() {
  const rows = await db
    .select({ queued: queuedTracksTable, track: tracksTable })
    .from(queuedTracksTable)
    .innerJoin(tracksTable, eq(tracksTable.id, queuedTracksTable.trackId))
    .orderBy(asc(queuedTracksTable.position));

  return rows.map((r) => ({ ...r.queued, track: r.track }));
}

router.get("/queue", async (_req, res): Promise<void> => {
  const queue = await getFullQueue();
  res.json(GetQueueResponse.parse(queue));
});

router.put("/queue", async (req, res): Promise<void> => {
  const parsed = ReplaceQueueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.delete(queuedTracksTable);

  if (parsed.data.trackIds.length > 0) {
    await db.insert(queuedTracksTable).values(
      parsed.data.trackIds.map((trackId, i) => ({ trackId, position: i }))
    );
  }

  const queue = await getFullQueue();
  res.json(ReplaceQueueResponse.parse(queue));
});

router.post("/queue", async (req, res): Promise<void> => {
  const parsed = AddToQueueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db.select().from(queuedTracksTable).orderBy(asc(queuedTracksTable.position));
  const nextPos = existing.length;

  await db.insert(queuedTracksTable).values(
    parsed.data.trackIds.map((trackId, i) => ({ trackId, position: nextPos + i }))
  );

  const queue = await getFullQueue();
  res.json(AddToQueueResponse.parse(queue));
});

router.delete("/queue", async (_req, res): Promise<void> => {
  await db.delete(queuedTracksTable);
  res.sendStatus(204);
});

router.delete("/queue/:id", async (req, res): Promise<void> => {
  const params = RemoveFromQueueParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(queuedTracksTable).where(eq(queuedTracksTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
