import { Router, type IRouter } from "express";
import { eq, and, or, ilike, asc, desc, like } from "drizzle-orm";
import { db, tracksTable } from "@workspace/db";
import {
  CreateTrackBody,
  UpdateTrackBody,
  UpdateTrackParams,
  GetTrackParams,
  DeleteTrackParams,
  ListTracksResponse,
  GetTrackResponse,
  UpdateTrackResponse,
  BulkUpsertTracksBody,
  BulkUpsertTracksResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const SORT_COLUMNS: Record<string, typeof tracksTable.title> = {
  title: tracksTable.title,
  artist: tracksTable.artist,
  album: tracksTable.album,
  genre: tracksTable.genre,
  fileName: tracksTable.fileName,
};

const SORT_COLUMNS_NUM: Record<string, typeof tracksTable.duration | typeof tracksTable.year | typeof tracksTable.rating | typeof tracksTable.trackNumber> = {
  duration: tracksTable.duration,
  year: tracksTable.year,
  rating: tracksTable.rating,
  trackNumber: tracksTable.trackNumber,
};

router.get("/tracks", requireAuth, async (req, res): Promise<void> => {
  const { search, artist, album, genre, sortBy = "artist", sortDir = "asc" } = req.query as Record<string, string>;
  const userId = req.userId!;

  let query = db.select().from(tracksTable).$dynamic();

  const conditions = [eq(tracksTable.userId, userId)];
  if (search) {
    conditions.push(
      or(
        ilike(tracksTable.title, `%${search}%`),
        ilike(tracksTable.artist, `%${search}%`),
        ilike(tracksTable.album, `%${search}%`),
        ilike(tracksTable.genre, `%${search}%`)
      )!
    );
  }
  if (artist) conditions.push(ilike(tracksTable.artist, `%${artist}%`));
  if (album) conditions.push(ilike(tracksTable.album, `%${album}%`));
  if (genre) conditions.push(ilike(tracksTable.genre, `%${genre}%`));

  query = query.where(and(...conditions));

  const dirFn = sortDir === "desc" ? desc : asc;
  const textCol = SORT_COLUMNS[sortBy];
  const numCol = SORT_COLUMNS_NUM[sortBy];
  if (textCol) {
    query = query.orderBy(dirFn(textCol));
  } else if (numCol) {
    query = query.orderBy(dirFn(numCol));
  } else {
    query = query.orderBy(asc(tracksTable.artist), asc(tracksTable.album), asc(tracksTable.trackNumber));
  }

  const tracks = await query;
  res.json(ListTracksResponse.parse(tracks));
});

router.post("/tracks", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateTrackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [track] = await db.insert(tracksTable).values({ ...parsed.data, userId: req.userId! }).returning();
  res.status(201).json(GetTrackResponse.parse(track));
});

router.post("/tracks/bulk", requireAuth, async (req, res): Promise<void> => {
  const parsed = BulkUpsertTracksBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.userId!;

  const results: (typeof tracksTable.$inferSelect)[] = [];

  for (const t of parsed.data.tracks) {
    if (t.source === "subsonic" && t.subsonicId && t.subsonicServerId) {
      const existing = await db
        .select()
        .from(tracksTable)
        .where(
          and(
            eq(tracksTable.userId, userId),
            eq(tracksTable.subsonicId, t.subsonicId),
            eq(tracksTable.subsonicServerId, t.subsonicServerId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const [updated] = await db
          .update(tracksTable)
          .set({ ...t, userId, updatedAt: new Date() })
          .where(and(eq(tracksTable.id, existing[0].id), eq(tracksTable.userId, userId)))
          .returning();
        results.push(updated);
      } else {
        const [inserted] = await db.insert(tracksTable).values({ ...t, userId }).returning();
        results.push(inserted);
      }
    } else {
      const existing = await db
        .select()
        .from(tracksTable)
        .where(
          and(
            eq(tracksTable.userId, userId),
            eq(tracksTable.folderPath, t.folderPath ?? ""),
            eq(tracksTable.fileName, t.fileName)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const [updated] = await db
          .update(tracksTable)
          .set({ ...t, userId, updatedAt: new Date() })
          .where(and(eq(tracksTable.id, existing[0].id), eq(tracksTable.userId, userId)))
          .returning();
        results.push(updated);
      } else {
        const [inserted] = await db.insert(tracksTable).values({ ...t, userId }).returning();
        results.push(inserted);
      }
    }
  }

  res.json(BulkUpsertTracksResponse.parse({ upserted: results.length, tracks: results }));
});

router.patch("/tracks/:id/replaygain", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateTrackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const { gain } = req.body as { gain?: unknown };
  if (typeof gain !== 'number' || !isFinite(gain)) {
    res.status(400).json({ error: "gain must be a finite number" });
    return;
  }
  const [track] = await db
    .update(tracksTable)
    .set({ replaygainGain: gain, updatedAt: new Date() })
    .where(and(eq(tracksTable.id, params.data.id), eq(tracksTable.userId, req.userId!)))
    .returning();
  if (!track) {
    res.status(404).json({ error: "Track not found" });
    return;
  }
  res.json(UpdateTrackResponse.parse(track));
});

router.delete("/tracks/local", requireAuth, async (req, res): Promise<void> => {
  await db.delete(tracksTable).where(and(eq(tracksTable.userId, req.userId!), eq(tracksTable.source, "local")));
  res.sendStatus(204);
});

router.delete("/tracks/subsonic", requireAuth, async (req, res): Promise<void> => {
  await db.delete(tracksTable).where(and(eq(tracksTable.userId, req.userId!), eq(tracksTable.source, "subsonic")));
  res.sendStatus(204);
});

router.delete("/tracks/folder", requireAuth, async (req, res): Promise<void> => {
  const { name } = req.query as Record<string, string>;
  if (!name) { res.status(400).json({ error: "folder name required" }); return; }
  await db.delete(tracksTable).where(
    and(eq(tracksTable.userId, req.userId!), eq(tracksTable.source, "local"), like(tracksTable.folderPath, `${name}%`))
  );
  res.sendStatus(204);
});

router.get("/tracks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetTrackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [track] = await db.select().from(tracksTable).where(and(eq(tracksTable.id, params.data.id), eq(tracksTable.userId, req.userId!)));
  if (!track) {
    res.status(404).json({ error: "Track not found" });
    return;
  }
  res.json(GetTrackResponse.parse(track));
});

router.patch("/tracks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateTrackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateTrackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [track] = await db
    .update(tracksTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(tracksTable.id, params.data.id), eq(tracksTable.userId, req.userId!)))
    .returning();
  if (!track) {
    res.status(404).json({ error: "Track not found" });
    return;
  }
  res.json(UpdateTrackResponse.parse(track));
});

router.delete("/tracks/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteTrackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(tracksTable).where(and(eq(tracksTable.id, params.data.id), eq(tracksTable.userId, req.userId!)));
  res.sendStatus(204);
});

export default router;
