import { Router, type IRouter } from "express";
import { eq, and, or, ilike, gte, lte, gt, lt } from "drizzle-orm";
import { db, playlistsTable, playlistTracksTable, tracksTable } from "@workspace/db";
import {
  CreatePlaylistBody,
  UpdatePlaylistBody,
  UpdatePlaylistParams,
  GetPlaylistParams,
  DeletePlaylistParams,
  GetPlaylistTracksParams,
  AddTrackToPlaylistBody,
  AddTrackToPlaylistParams,
  RemoveTrackFromPlaylistParams,
  ListPlaylistsResponse,
  GetPlaylistResponse,
  UpdatePlaylistResponse,
  GetPlaylistTracksResponse,
} from "@workspace/api-zod";
import type { SQL } from "drizzle-orm";

const router: IRouter = Router();

function parseSmartQuery(query: string, table: typeof tracksTable): SQL | undefined {
  const fieldMap: Record<string, typeof tracksTable.title | typeof tracksTable.artist | typeof tracksTable.album | typeof tracksTable.genre | typeof tracksTable.year | typeof tracksTable.duration | typeof tracksTable.rating> = {
    title: table.title,
    artist: table.artist,
    album: table.album,
    genre: table.genre,
    year: table.year,
    duration: table.duration,
    rating: table.rating,
  };

  const conditions: SQL[] = [];
  const parts = query.split(/\bAND\b/i);

  for (const part of parts) {
    const trimmed = part.trim();
    const containsMatch = trimmed.match(/(\w+)\s+contains\s+"([^"]+)"/i);
    const eqMatch = trimmed.match(/(\w+)\s*=\s*"([^"]+)"/i);
    const neqMatch = trimmed.match(/(\w+)\s*!=\s*"([^"]+)"/i);
    const gteMatch = trimmed.match(/(\w+)\s*>=\s*([\d.]+)/);
    const lteMatch = trimmed.match(/(\w+)\s*<=\s*([\d.]+)/);
    const gtMatch = trimmed.match(/(\w+)\s*>\s*([\d.]+)/);
    const ltMatch = trimmed.match(/(\w+)\s*<\s*([\d.]+)/);

    if (containsMatch) {
      const col = fieldMap[containsMatch[1].toLowerCase()];
      if (col) conditions.push(ilike(col as typeof table.title, `%${containsMatch[2]}%`));
    } else if (eqMatch) {
      const col = fieldMap[eqMatch[1].toLowerCase()];
      if (col) conditions.push(eq(col, eqMatch[2] as never));
    } else if (neqMatch) {
      const col = fieldMap[neqMatch[1].toLowerCase()];
      if (col) conditions.push(eq(col, neqMatch[2] as never));
    } else if (gteMatch) {
      const col = fieldMap[gteMatch[1].toLowerCase()];
      if (col) conditions.push(gte(col as typeof table.year, Number(gteMatch[2]) as never));
    } else if (lteMatch) {
      const col = fieldMap[lteMatch[1].toLowerCase()];
      if (col) conditions.push(lte(col as typeof table.year, Number(lteMatch[2]) as never));
    } else if (gtMatch) {
      const col = fieldMap[gtMatch[1].toLowerCase()];
      if (col) conditions.push(gt(col as typeof table.year, Number(gtMatch[2]) as never));
    } else if (ltMatch) {
      const col = fieldMap[ltMatch[1].toLowerCase()];
      if (col) conditions.push(lt(col as typeof table.year, Number(ltMatch[2]) as never));
    }
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

router.get("/playlists", async (_req, res): Promise<void> => {
  const playlists = await db.select().from(playlistsTable).orderBy(playlistsTable.createdAt);
  res.json(ListPlaylistsResponse.parse(playlists));
});

router.post("/playlists", async (req, res): Promise<void> => {
  const parsed = CreatePlaylistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [playlist] = await db.insert(playlistsTable).values(parsed.data).returning();
  res.status(201).json(GetPlaylistResponse.parse(playlist));
});

router.get("/playlists/:id", async (req, res): Promise<void> => {
  const params = GetPlaylistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [playlist] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, params.data.id));
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json(GetPlaylistResponse.parse(playlist));
});

router.patch("/playlists/:id", async (req, res): Promise<void> => {
  const params = UpdatePlaylistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePlaylistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [playlist] = await db
    .update(playlistsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(playlistsTable.id, params.data.id))
    .returning();
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }
  res.json(UpdatePlaylistResponse.parse(playlist));
});

router.delete("/playlists/:id", async (req, res): Promise<void> => {
  const params = DeletePlaylistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(playlistTracksTable).where(eq(playlistTracksTable.playlistId, params.data.id));
  await db.delete(playlistsTable).where(eq(playlistsTable.id, params.data.id));
  res.sendStatus(204);
});

router.get("/playlists/:id/tracks", async (req, res): Promise<void> => {
  const params = GetPlaylistTracksParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [playlist] = await db.select().from(playlistsTable).where(eq(playlistsTable.id, params.data.id));
  if (!playlist) {
    res.status(404).json({ error: "Playlist not found" });
    return;
  }

  if (playlist.query) {
    const condition = parseSmartQuery(playlist.query, tracksTable);
    const tracks = condition
      ? await db.select().from(tracksTable).where(condition)
      : await db.select().from(tracksTable);
    res.json(GetPlaylistTracksResponse.parse(tracks));
    return;
  }

  const rows = await db
    .select({ track: tracksTable })
    .from(playlistTracksTable)
    .innerJoin(tracksTable, eq(tracksTable.id, playlistTracksTable.trackId))
    .where(eq(playlistTracksTable.playlistId, params.data.id))
    .orderBy(playlistTracksTable.position);

  res.json(GetPlaylistTracksResponse.parse(rows.map((r) => r.track)));
});

router.post("/playlists/:id/tracks", async (req, res): Promise<void> => {
  const params = AddTrackToPlaylistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddTrackToPlaylistBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existingRows = await db
    .select()
    .from(playlistTracksTable)
    .where(eq(playlistTracksTable.playlistId, params.data.id))
    .orderBy(playlistTracksTable.position);

  const position = parsed.data.position ?? existingRows.length;
  const [row] = await db
    .insert(playlistTracksTable)
    .values({ playlistId: params.data.id, trackId: parsed.data.trackId, position })
    .returning();
  res.status(201).json(row);
});

router.delete("/playlists/:id/tracks/:trackId", async (req, res): Promise<void> => {
  const params = RemoveTrackFromPlaylistParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(playlistTracksTable)
    .where(
      and(
        eq(playlistTracksTable.playlistId, params.data.id),
        eq(playlistTracksTable.trackId, params.data.trackId)
      )
    );
  res.sendStatus(204);
});

export default router;
