import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { db, ytSearchHistoryTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { searchYouTube, getStreamUrl, resolvePlaylist } from "../lib/youtube";
import { getStatus as getOpentracerStatus } from "../lib/opentracer";

const router: IRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER_SCRIPT = path.join(__dirname, "ytmdl_helper.py");

// ── Resource limits (Spotify subprocess only) ──────────────────────────────

/** Maximum simultaneous Python helper processes across all users. */
const MAX_GLOBAL_HELPERS = 5;

/** Maximum simultaneous helper processes per individual user. */
const MAX_USER_HELPERS = 2;

/** Hard wall-clock timeout for a single helper invocation (ms). */
const HELPER_TIMEOUT_MS = 90_000;

/** Maximum bytes accumulated from helper stdout + stderr before killing. */
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;

/** Maximum playlist items returned for a single resolve request. */
const MAX_PLAYLIST_ITEMS = 200;

/**
 * Per-user sliding-window rate limit for all yt-backed endpoints.
 * Caps individual users at 20 requests per minute.
 */
const ytUserRateLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  keyGenerator(req: Request) {
    return (req as Record<string, unknown>).userId
      ? `uid:${(req as Record<string, unknown>).userId}`
      : `ip:${req.ip}`;
  },
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  validate: { trustProxy: false },
});

// ── Process-level helper concurrency control ──────────────────────────────

let activeHelpers = 0;
const userHelperCount = new Map<string, number>();

function canSpawn(userId: string): boolean {
  if (activeHelpers >= MAX_GLOBAL_HELPERS) return false;
  const userCount = userHelperCount.get(userId) || 0;
  return userCount < MAX_USER_HELPERS;
}

function incrementHelpers(userId: string) {
  activeHelpers++;
  userHelperCount.set(userId, (userHelperCount.get(userId) || 0) + 1);
}

function decrementHelpers(userId: string) {
  activeHelpers = Math.max(0, activeHelpers - 1);
  const current = userHelperCount.get(userId) || 0;
  if (current <= 1) {
    userHelperCount.delete(userId);
  } else {
    userHelperCount.set(userId, current - 1);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function spotifyClientEnv(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function buildPythonCommand(command: Record<string, unknown>): string {
  return JSON.stringify(command);
}

function invokePythonHelper(
  userId: string,
  command: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (!canSpawn(userId)) {
      return reject(new Error("Too many concurrent requests. Please try again shortly."));
    }

    incrementHelpers(userId);

    const child = spawn("python3", [HELPER_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: HELPER_TIMEOUT_MS,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, HELPER_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
      if (stdout.length > MAX_OUTPUT_BYTES) {
        killed = true;
        child.kill("SIGKILL");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      decrementHelpers(userId);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      decrementHelpers(userId);

      if (killed) {
        return reject(new Error("Helper process timed out or output exceeded limit"));
      }

      if (code !== 0) {
        return reject(
          new Error(stderr.trim() || `Helper exited with code ${code}`),
        );
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch {
        reject(new Error("Invalid JSON from helper"));
      }
    });

    child.stdin.write(buildPythonCommand(command));
    child.stdin.end();
  });
}

// ── Routes ─────────────────────────────────────────────────────────────────

// POST /api/yt/search
router.post("/api/yt/search", ytUserRateLimit, requireAuth, async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({ error: "Query is required" });
    }

    const result = await searchYouTube(query.trim());

    try {
      const userId = (req as Record<string, unknown>).userId as string;
      if (userId) {
        await db.insert(ytSearchHistoryTable).values({
          userId,
          query: query.trim(),
        });
      }
    } catch {
      // history insert is best-effort, don't fail the search
    }

    res.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to search YouTube";
    res.status(500).json({ error: message });
  }
});

// POST /api/yt/stream
router.post("/api/yt/stream", ytUserRateLimit, requireAuth, async (req: Request, res: Response) => {
  try {
    const { videoId } = req.body;
    if (!videoId || typeof videoId !== "string") {
      return res.status(400).json({ error: "videoId is required" });
    }

    const result = await getStreamUrl(videoId);
    res.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to get stream URL";
    res.status(500).json({ error: message });
  }
});

// POST /api/yt/playlist
router.post("/api/yt/playlist", ytUserRateLimit, requireAuth, async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    const result = await resolvePlaylist(url, MAX_PLAYLIST_ITEMS);
    res.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to resolve playlist";
    res.status(500).json({ error: message });
  }
});

// POST /api/yt/spotify
router.post("/api/yt/spotify", ytUserRateLimit, requireAuth, async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    const spotifyCreds = spotifyClientEnv();
    if (!spotifyCreds) {
      return res.status(503).json({
        error: "Spotify not configured: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required",
      });
    }

    const userId =
      ((req as Record<string, unknown>).userId as string) || req.ip || "anonymous";

    const command = {
      cmd: "resolve-spotify",
      url,
      client_id: spotifyCreds.clientId,
      client_secret: spotifyCreds.clientSecret,
      max_items: MAX_PLAYLIST_ITEMS,
    };

    const result = await invokePythonHelper(userId, command);

    if (result.error) {
      return res.status(500).json({ error: result.error });
    }

    res.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to resolve Spotify URL";
    res.status(500).json({ error: message });
  }
});

// GET /api/yt/history
router.get("/api/yt/history", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as Record<string, unknown>).userId as string;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const rows = await db
      .select()
      .from(ytSearchHistoryTable)
      .where(eq(ytSearchHistoryTable.userId, userId))
      .orderBy(desc(ytSearchHistoryTable.createdAt))
      .limit(50);

    res.json({ history: rows });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch search history";
    res.status(500).json({ error: message });
  }
});

// DELETE /api/yt/history/:id
router.delete("/api/yt/history/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as Record<string, unknown>).userId as string;
    const id = req.params.id;

    if (!userId || !id) {
      return res.status(400).json({ error: "Missing user ID or history entry ID" });
    }

    const deleted = await db
      .delete(ytSearchHistoryTable)
      .where(
        and(eq(ytSearchHistoryTable.id, id), eq(ytSearchHistoryTable.userId, userId)),
      )
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({ error: "History entry not found" });
    }

    res.json({ ok: true, deleted: deleted[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete history entry";
    res.status(500).json({ error: message });
  }
});

// ── GET /api/yt/opentracer-status ─────────────────────────────────────────

router.get("/api/yt/opentracer-status", (req, res) => {
  try {
    res.json(getOpentracerStatus());
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error fetching opentracer status";
    res.status(500).json({ error: message });
  }
});

export default router;
