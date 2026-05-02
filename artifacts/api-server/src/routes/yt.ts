import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import path from "path";
import { db, ytSearchHistoryTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { requireAuth, requireStreamAuth } from "../middlewares/auth";

const router: IRouter = Router();

const HELPER_SCRIPT = path.join(process.cwd(), "../../scripts/ytmdl_helper.py");

function runHelper(command: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [HELPER_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      const raw = stdout.trim();
      if (!raw) {
        return reject(new Error(stderr.trim() || `Helper exited with code ${code} and no output`));
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "error" in parsed) {
          return reject(new Error((parsed as { error: string }).error));
        }
        resolve(parsed);
      } catch {
        reject(new Error(`Failed to parse helper output: ${raw.slice(0, 200)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn helper: ${err.message}`));
    });

    proc.stdin.write(JSON.stringify(command));
    proc.stdin.end();
  });
}

router.get("/yt/search", requireAuth, async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limit = Math.min(Number(req.query.limit) || 10, 25);

  if (!q) {
    res.status(400).json({ error: "q parameter is required" });
    return;
  }

  try {
    const result = await runHelper({ cmd: "search", q, limit }) as { tracks: unknown[] };

    const userId = req.userId!;
    await db.insert(ytSearchHistoryTable).values({ userId, query: q }).catch(() => {});

    res.json({ tracks: result.tracks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    res.status(500).json({ error: message });
  }
});

router.get("/yt/stream/:videoId", requireStreamAuth, async (req, res): Promise<void> => {
  const { videoId } = req.params;

  if (!videoId || !/^[\w-]{5,20}$/.test(videoId)) {
    res.status(400).json({ error: "Invalid videoId" });
    return;
  }

  try {
    const result = await runHelper({ cmd: "stream", videoId }) as {
      streamUrl: string;
      title: string;
      duration: number;
      thumbnail: string;
    };

    res.json({
      videoId,
      streamUrl: result.streamUrl,
      title: result.title,
      duration: result.duration,
      thumbnail: result.thumbnail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream resolution failed";
    res.status(500).json({ error: message });
  }
});

router.post("/yt/resolve-url", requireAuth, async (req, res): Promise<void> => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "url is required" });
    return;
  }

  try {
    let hostname: string;
    try {
      hostname = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    let result: unknown;

    if (hostname === "spotify.com" || hostname.endsWith(".spotify.com")) {
      const clientId = process.env.SPOTIFY_CLIENT_ID;
      const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        res.status(422).json({ error: "Spotify not configured: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set" });
        return;
      }

      result = await runHelper({
        cmd: "resolve-spotify",
        url,
        client_id: clientId,
        client_secret: clientSecret,
      });
    } else if (hostname === "youtube.com" || hostname === "youtu.be" || hostname.endsWith(".youtube.com")) {
      result = await runHelper({ cmd: "resolve-youtube-playlist", url });
    } else {
      res.status(400).json({ error: `Unsupported URL host: ${hostname}. Supported: youtube.com, spotify.com` });
      return;
    }

    const { tracks } = result as { tracks: unknown[] };
    res.json({ tracks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "URL resolution failed";
    res.status(500).json({ error: message });
  }
});

router.get("/yt/history", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  try {
    const rows = await db
      .select()
      .from(ytSearchHistoryTable)
      .where(eq(ytSearchHistoryTable.userId, userId))
      .orderBy(desc(ytSearchHistoryTable.createdAt))
      .limit(limit);

    res.json({ history: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch history";
    res.status(500).json({ error: message });
  }
});

router.delete("/yt/history/:id", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    const deleted = await db
      .delete(ytSearchHistoryTable)
      .where(and(eq(ytSearchHistoryTable.id, id), eq(ytSearchHistoryTable.userId, userId)))
      .returning();

    if (deleted.length === 0) {
      res.status(404).json({ error: "History entry not found or does not belong to you" });
      return;
    }

    res.json({ ok: true, deleted: deleted[0] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete history entry";
    res.status(500).json({ error: message });
  }
});

export default router;
