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

router.get("/subsonic-servers", async (_req, res): Promise<void> => {
  const servers = await db.select().from(subsonicServersTable).orderBy(subsonicServersTable.createdAt);
  res.json(ListSubsonicServersResponse.parse(servers.map(toPublic)));
});

router.post("/subsonic-servers", async (req, res): Promise<void> => {
  const parsed = CreateSubsonicServerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [server] = await db.insert(subsonicServersTable).values(parsed.data).returning();
  res.status(201).json(toPublic(server));
});

router.patch("/subsonic-servers/:id", async (req, res): Promise<void> => {
  const params = UpdateSubsonicServerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateSubsonicServerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [server] = await db
    .update(subsonicServersTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(subsonicServersTable.id, params.data.id))
    .returning();
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }
  res.json(UpdateSubsonicServerResponse.parse(toPublic(server)));
});

router.delete("/subsonic-servers/:id", async (req, res): Promise<void> => {
  const params = DeleteSubsonicServerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  await db.delete(subsonicServersTable).where(eq(subsonicServersTable.id, params.data.id));
  res.sendStatus(204);
});

// ── TEST ──────────────────────────────────────────────────────────────────────

router.get("/subsonic-servers/:id/test", async (req, res): Promise<void> => {
  const params = TestSubsonicServerParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [server] = await db.select().from(subsonicServersTable).where(eq(subsonicServersTable.id, params.data.id));
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

// ── SYNC ──────────────────────────────────────────────────────────────────────
// POST /api/subsonic-servers/:id/sync
// Fetches the full catalog via search3 (paginated, 500/page) and bulk-upserts tracks.

router.post("/subsonic-servers/:id/sync", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [server] = await db.select().from(subsonicServersTable).where(eq(subsonicServersTable.id, id));
  if (!server) { res.status(404).json({ error: "Server not found" }); return; }

  const allSongs: any[] = [];
  const PAGE_SIZE = 500;
  let offset = 0;
  let hasMore = true;

  try {
    while (hasMore) {
      const url = subsonicUrl(server, "search3", { query: "", songCount: PAGE_SIZE, songOffset: offset, albumCount: 0, artistCount: 0 });
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as any;
      const sub = data["subsonic-response"];
      if (sub?.status !== "ok") throw new Error(sub?.error?.message ?? "Subsonic error");

      const songs: any[] = sub.searchResult3?.song ?? [];
      allSongs.push(...songs);
      if (songs.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
      }
    }

    // Upsert tracks
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
        fileName: song.path?.split("/").pop() ?? song.id,
        folderPath: song.path?.split("/").slice(0, -1).join("/") ?? "",
        albumArtDataUrl: null,
        source: "subsonic" as const,
        subsonicId: String(song.id),
        subsonicServerId: server.id,
      };

      const existing = await db
        .select({ id: tracksTable.id })
        .from(tracksTable)
        .where(and(eq(tracksTable.subsonicId, String(song.id)), eq(tracksTable.subsonicServerId, server.id)))
        .limit(1);

      if (existing.length > 0) {
        await db.update(tracksTable).set({ ...track, updatedAt: new Date() }).where(eq(tracksTable.id, existing[0].id));
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
// GET /api/subsonic-servers/:id/stream/:subsonicTrackId
// Proxies the audio stream so credentials never leave the server.

router.get("/subsonic-servers/:id/stream/:subsonicTrackId", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const subsonicTrackId = req.params.subsonicTrackId;

  if (isNaN(id)) { res.status(400).end(); return; }

  const [server] = await db.select().from(subsonicServersTable).where(eq(subsonicServersTable.id, id));
  if (!server) { res.status(404).end(); return; }

  try {
    const streamUrl = subsonicUrl(server, "stream", { id: subsonicTrackId, maxBitRate: 0 });

    // Forward Range header for seek support
    const headers: Record<string, string> = {};
    if (req.headers.range) headers["Range"] = req.headers.range;

    const upstream = await fetch(streamUrl, { headers, signal: AbortSignal.timeout(10000) });

    // Forward status + key headers
    res.status(upstream.status);
    const forward = ["content-type", "content-length", "content-range", "accept-ranges"];
    for (const h of forward) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("Cache-Control", "no-cache");

    if (!upstream.body) { res.end(); return; }

    // Pipe body
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
