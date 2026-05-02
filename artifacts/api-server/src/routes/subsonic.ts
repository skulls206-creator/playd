import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, subsonicServersTable, tracksTable } from "@workspace/db";
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
import { z } from "zod/v4";
import { requireAuth, requireStreamAuth } from "../middlewares/auth";

const router: IRouter = Router();

function toPublic(server: typeof subsonicServersTable.$inferSelect) {
  const { password: _pw, ...rest } = server;
  return rest;
}

/** Normalize a server URL to always have a protocol */
function normalizeServerUrl(url: string): string {
  const trimmed = url.replace(/\/$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Build a Subsonic REST API URL with auth params */
function subsonicUrl(server: typeof subsonicServersTable.$inferSelect, endpoint: string, extra?: Record<string, string | number>) {
  const base = normalizeServerUrl(server.url);
  const params = new URLSearchParams({
    v: "1.16.1",
    c: "foobarweb",
    f: "json",
    u: server.username,
    p: server.password,
    ...Object.fromEntries(Object.entries(extra ?? {}).map(([k, v]) => [k, String(v)])),
  });
  return `${base}/rest/${endpoint}?${params}`;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

router.get("/subsonic-servers", requireAuth, async (req, res): Promise<void> => {
  const servers = await db.select().from(subsonicServersTable).where(eq(subsonicServersTable.userId, req.userId!)).orderBy(subsonicServersTable.createdAt);
  res.json(ListSubsonicServersResponse.parse(servers.map(toPublic)));
});

router.post("/subsonic-servers", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateSubsonicServerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [server] = await db.insert(subsonicServersTable).values({ ...parsed.data, userId: req.userId! }).returning();
  res.status(201).json(toPublic(server));
});

router.patch("/subsonic-servers/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateSubsonicServerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateSubsonicServerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData = { ...parsed.data, updatedAt: new Date() };
  if (!updateData.password) delete (updateData as any).password;

  const [server] = await db
    .update(subsonicServersTable)
    .set(updateData)
    .where(and(eq(subsonicServersTable.id, params.data.id), eq(subsonicServersTable.userId, req.userId!)))
    .returning();
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  res.json(UpdateSubsonicServerResponse.parse(toPublic(server)));
});

router.delete("/subsonic-servers/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteSubsonicServerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.delete(subsonicServersTable).where(and(eq(subsonicServersTable.id, params.data.id), eq(subsonicServersTable.userId, req.userId!)));
  res.sendStatus(204);
});

// ── TEST ──────────────────────────────────────────────────────────────────────

router.get("/subsonic-servers/:id/test", requireAuth, async (req, res): Promise<void> => {
  const params = TestSubsonicServerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [server] = await db.select().from(subsonicServersTable).where(and(eq(subsonicServersTable.id, params.data.id), eq(subsonicServersTable.userId, req.userId!)));
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }

  try {
    const pingUrl = subsonicUrl(server, "ping.view");
    const response = await fetch(pingUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      res.json(TestSubsonicServerResponse.parse({ success: false, message: `HTTP ${response.status}`, version: null }));
      return;
    }
    const data = await response.json() as any;
    const sub = data["subsonic-response"];
    if (sub?.status === "ok") {
      res.json(TestSubsonicServerResponse.parse({ success: true, message: "Connected successfully", version: sub.version ?? null }));
    } else {
      res.json(TestSubsonicServerResponse.parse({ success: false, message: sub?.error?.message ?? "Unknown error", version: null }));
    }
  } catch (err) {
    logger.error({ err }, "Subsonic test failed");
    res.json(TestSubsonicServerResponse.parse({ success: false, message: "Connection failed", version: null }));
  }
});

// ── CONFIG (for client-side Subsonic API calls) ───────────────────────────────

router.get("/subsonic-servers/:id/config", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [server] = await db.select().from(subsonicServersTable).where(and(eq(subsonicServersTable.id, id), eq(subsonicServersTable.userId, req.userId!)));
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  res.json({ id: server.id, name: server.name, url: server.url.replace(/\/$/, ""), username: server.username, password: server.password });
});

// ── SYNC ──────────────────────────────────────────────────────────────────────

async function subsonicFetch(url: string, timeoutMs = 15000): Promise<any> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json() as any;
  const sub = data["subsonic-response"];
  if (sub?.status !== "ok") throw new Error(sub?.error?.message ?? "Subsonic API error");
  return sub;
}

router.post("/subsonic-servers/:id/sync", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const userId = req.userId!;

  const [server] = await db.select().from(subsonicServersTable).where(and(eq(subsonicServersTable.id, id), eq(subsonicServersTable.userId, userId)));
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }

  const songMap = new Map<string, any>();

  try {
    // Strategy 1: getAlbumList2 paginated
    try {
      const PAGE = 500;
      let offset = 0;
      const albumIds = new Set<string>();
      while (true) {
        const sub = await subsonicFetch(subsonicUrl(server, "getAlbumList2", { type: "alphabeticalByName", size: PAGE, offset }));
        const albums: any[] = sub.albumList2?.album ?? [];
        if (albums.length === 0) break;
        for (const a of albums) albumIds.add(String(a.id));
        if (albums.length < PAGE) break;
        offset += PAGE;
      }
      logger.info({ albumCount: albumIds.size }, "Strategy 1: albums found");
      for (const albumId of albumIds) {
        try {
          const albumSub = await subsonicFetch(subsonicUrl(server, "getAlbum", { id: albumId }));
          for (const s of albumSub.album?.song ?? []) songMap.set(String(s.id), s);
        } catch { }
      }
      logger.info({ count: songMap.size }, "Strategy 1 done");
    } catch (e) {
      logger.warn({ e }, "Strategy 1 failed");
    }

    // Strategy 2: getSongs paginated
    try {
      const PAGE = 500;
      let offset = 0;
      while (true) {
        const sub = await subsonicFetch(subsonicUrl(server, "getSongs", { size: PAGE, offset }));
        const songs: any[] = sub.songs?.song ?? [];
        if (songs.length === 0) break;
        for (const s of songs) songMap.set(String(s.id), s);
        if (songs.length < PAGE) break;
        offset += PAGE;
      }
      logger.info({ count: songMap.size }, "Strategy 2 done");
    } catch (e) {
      logger.warn({ e }, "Strategy 2 failed");
    }

    // Strategy 3: getArtists traversal
    try {
      const artistsSub = await subsonicFetch(subsonicUrl(server, "getArtists"));
      const indices: any[] = artistsSub.artists?.index ?? [];
      const artistIds: string[] = [];
      for (const idx of indices) {
        for (const a of idx.artist ?? []) artistIds.push(String(a.id));
      }
      for (const artistId of artistIds) {
        try {
          const artistSub = await subsonicFetch(subsonicUrl(server, "getArtist", { id: artistId }));
          for (const album of artistSub.artist?.album ?? []) {
            try {
              const albumSub = await subsonicFetch(subsonicUrl(server, "getAlbum", { id: String(album.id) }));
              for (const s of albumSub.album?.song ?? []) songMap.set(String(s.id), s);
            } catch { }
          }
        } catch { }
      }
      logger.info({ count: songMap.size }, "Strategy 3 done");
    } catch (e) {
      logger.warn({ e }, "Strategy 3 failed");
    }

    // Strategy 4: getRandomSongs catch-all
    try {
      for (let i = 0; i < 3; i++) {
        const sub = await subsonicFetch(subsonicUrl(server, "getRandomSongs", { size: 500 }));
        for (const s of sub.randomSongs?.song ?? []) songMap.set(String(s.id), s);
      }
      logger.info({ count: songMap.size }, "Strategy 4 done");
    } catch (e) {
      logger.warn({ e }, "Strategy 4 failed");
    }

    const allSongs = Array.from(songMap.values());
    logger.info({ total: allSongs.length }, "Sync: total unique songs");

    let upserted = 0;
    for (const song of allSongs) {
      const track = {
        title: song.title || "Unknown Title",
        artist: song.artist || "Unknown Artist",
        album: song.album || "Unknown Album",
        year: song.year ?? null,
        genre: song.genre ?? null,
        duration: Math.round(song.duration ?? 0),
        trackNumber: song.track ?? null,
        fileName: song.path?.split("/").pop() ?? String(song.id),
        folderPath: song.path?.split("/").slice(0, -1).join("/") ?? "",
        albumArtDataUrl: null,
        source: "subsonic" as const,
        subsonicId: String(song.id),
        subsonicServerId: server.id,
        userId,
      };

      const existing = await db
        .select({ id: tracksTable.id })
        .from(tracksTable)
        .where(and(eq(tracksTable.userId, userId), eq(tracksTable.subsonicId, String(song.id)), eq(tracksTable.subsonicServerId, server.id)))
        .limit(1);

      if (existing.length > 0) {
        await db.update(tracksTable).set({ ...track, updatedAt: new Date() }).where(and(eq(tracksTable.id, existing[0].id), eq(tracksTable.userId, userId)));
      } else {
        await db.insert(tracksTable).values(track);
      }
      upserted++;
    }

    logger.info({ serverId: id, upserted }, "Subsonic sync complete");
    res.json({ success: true, upserted, total: allSongs.length });
  } catch (err: any) {
    logger.error({ err }, "Subsonic sync failed");
    res.status(502).json({ success: false, error: err?.message ?? "Sync failed" });
  }
});

// ── STREAM PROXY ──────────────────────────────────────────────────────────────

router.get(
  "/subsonic-servers/:id/stream/:subsonicTrackId",
  requireStreamAuth((req) => `subsonic:${req.params.id}:${req.params.subsonicTrackId}`),
  async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const subsonicTrackId = req.params.subsonicTrackId;
  if (isNaN(id)) { res.status(400).end(); return; }

  const [server] = await db.select().from(subsonicServersTable).where(and(eq(subsonicServersTable.id, id), eq(subsonicServersTable.userId, req.userId!)));
  if (!server) { res.status(404).end(); return; }

  try {
    const streamUrl = subsonicUrl(server, "stream", { id: subsonicTrackId, maxBitRate: 0 });

    const headers: Record<string, string> = {};
    if (req.headers.range) headers["Range"] = req.headers.range;

    const upstream = await fetch(streamUrl, { headers, signal: AbortSignal.timeout(10000) });

    res.status(upstream.status);
    const forward = ["content-type", "content-length", "content-range", "accept-ranges"];
    for (const h of forward) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("Cache-Control", "no-cache");

    if (!upstream.body) { res.end(); return; }

    const reader = upstream.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        if (!res.writableEnded) res.write(value);
        else break;
      }
    };
    await pump();
  } catch (err: any) {
    logger.error({ err }, "Subsonic stream proxy failed");
    if (!res.headersSent) res.status(502).end();
  }
});

export default router;
