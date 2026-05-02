import { Router, type IRouter } from "express";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { db, ytSearchHistoryTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/auth";
import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";

const router: IRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER_SCRIPT = path.join(__dirname, "ytmdl_helper.py");

// ── Concurrency and resource limits ────────────────────────────────────────
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
 * Per-user sliding-window rate limit for helper-backed endpoints.
 * Caps individual users at 20 helper invocations per minute to bound
 * sequential abuse even when each request respects the concurrency limit.
 */
const ytUserRateLimit = rateLimit({
  windowMs: 60_000,
  max: 20,
  // All three routes that use this limiter are behind requireAuth, so userId is
  // always populated. Use it directly as the rate-limit key so limits are
  // per-user, not per-IP, and to avoid the IPv6-fallback validation warning.
  keyGenerator: (req) => String((req as Request & { userId?: number }).userId ?? "anon"),
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait before trying again." },
});

// Global concurrency state.
let activeGlobalHelpers = 0;
const activePerUser = new Map<number, number>();

function userHelperCount(userId: number): number {
  return activePerUser.get(userId) ?? 0;
}

function acquireHelper(userId: number): boolean {
  if (activeGlobalHelpers >= MAX_GLOBAL_HELPERS) return false;
  if (userHelperCount(userId) >= MAX_USER_HELPERS) return false;
  activeGlobalHelpers++;
  activePerUser.set(userId, userHelperCount(userId) + 1);
  return true;
}

function releaseHelper(userId: number): void {
  activeGlobalHelpers = Math.max(0, activeGlobalHelpers - 1);
  const cur = userHelperCount(userId);
  if (cur <= 1) {
    activePerUser.delete(userId);
  } else {
    activePerUser.set(userId, cur - 1);
  }
}

/**
 * Kill the entire process group rooted at `proc`.
 *
 * The helper is spawned with `detached: true` so it becomes the leader of a
 * new process group. Its yt-dlp children inherit the same PGID. Sending
 * SIGKILL to the *negated* PID (-pid) kills every process in that group,
 * preventing orphaned yt-dlp subprocesses from continuing after the timeout
 * or client disconnect.
 */
function killProcessGroup(pid: number | undefined): void {
  if (pid == null) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Process group may already be gone; ignore.
  }
}

interface RunHelperOptions {
  userId: number;
  req: Request;
  res: Response;
}

function runHelper(command: object, opts: RunHelperOptions): Promise<unknown> {
  const { userId, req, res } = opts;

  if (!acquireHelper(userId)) {
    return Promise.reject(
      Object.assign(
        new Error("Too many concurrent requests. Please try again shortly."),
        { statusCode: 429 }
      )
    );
  }

  return new Promise((resolve, reject) => {
    // detached: true puts the Python process into a new process group so we
    // can kill it *and* all its yt-dlp children via killProcessGroup().
    // unref() prevents the detached process from keeping the Node event loop
    // alive if we forget to clean up.
    const proc = spawn("python3", [HELPER_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    proc.unref();

    let stdoutBuf = "";
    let stderrBuf = "";
    let outputBytes = 0;
    let settled = false;

    function cleanup(reason?: Error) {
      if (settled) return;
      settled = true;
      releaseHelper(userId);
      killProcessGroup(proc.pid);
      if (reason) reject(reason);
    }

    // Hard timeout — kill the entire process group if it runs too long.
    const timer = setTimeout(() => {
      cleanup(
        Object.assign(
          new Error("Helper timed out. The request took too long to process."),
          { statusCode: 504 }
        )
      );
    }, HELPER_TIMEOUT_MS);

    // Cancel helper when the HTTP client disconnects.
    const onClose = () => {
      if (!settled) cleanup(new Error("Client disconnected"));
    };
    res.on("close", onClose);

    proc.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        cleanup(new Error("Helper produced too much output"));
        return;
      }
      stdoutBuf += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        cleanup(new Error("Helper produced too much output"));
        return;
      }
      stderrBuf += chunk.toString();
    });

    proc.on("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      res.off("close", onClose);
      settled = true;
      releaseHelper(userId);

      const raw = stdoutBuf.trim();
      if (!raw) {
        return reject(
          new Error(stderrBuf.trim() || `Helper exited with code ${code} and no output`)
        );
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
      if (settled) return;
      clearTimeout(timer);
      res.off("close", onClose);
      settled = true;
      releaseHelper(userId);
      reject(new Error(`Failed to spawn helper: ${err.message}`));
    });

    proc.stdin.write(JSON.stringify(command));
    proc.stdin.end();
  });
}

function helperErrorStatus(err: unknown): number {
  if (err && typeof err === "object" && "statusCode" in err) {
    return (err as { statusCode: number }).statusCode;
  }
  return 500;
}

router.get("/yt/search", requireAuth, ytUserRateLimit, async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limit = Math.min(Number(req.query.limit) || 10, 25);

  if (!q) {
    res.status(400).json({ error: "q parameter is required" });
    return;
  }

  try {
    const result = await runHelper(
      { cmd: "search", q, limit },
      { userId: req.userId!, req, res }
    ) as { tracks: unknown[] };

    const userId = req.userId!;
    await db.insert(ytSearchHistoryTable).values({ userId, query: q }).catch(() => {});

    res.json({ tracks: result.tracks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    res.status(helperErrorStatus(err)).json({ error: message });
  }
});

router.get("/yt/stream/:videoId", requireAuth, ytUserRateLimit, async (req, res): Promise<void> => {
  const videoId = req.params.videoId as string;

  if (!videoId || !/^[\w-]{5,20}$/.test(videoId)) {
    res.status(400).json({ error: "Invalid videoId" });
    return;
  }

  try {
    const result = await runHelper(
      { cmd: "stream", videoId },
      { userId: req.userId!, req, res }
    ) as {
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
    res.status(helperErrorStatus(err)).json({ error: message });
  }
});

router.post("/yt/resolve-url", requireAuth, ytUserRateLimit, async (req, res): Promise<void> => {
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
        res.status(422).json({
          error: "Spotify not configured: SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are not set",
        });
        return;
      }

      result = await runHelper(
        {
          cmd: "resolve-spotify",
          url,
          client_id: clientId,
          client_secret: clientSecret,
          max_items: MAX_PLAYLIST_ITEMS,
        },
        { userId: req.userId!, req, res }
      );
    } else if (
      hostname === "youtube.com" ||
      hostname === "youtu.be" ||
      hostname.endsWith(".youtube.com")
    ) {
      result = await runHelper(
        { cmd: "resolve-youtube-playlist", url, max_items: MAX_PLAYLIST_ITEMS },
        { userId: req.userId!, req, res }
      );
    } else {
      res.status(400).json({
        error: `Unsupported URL host: ${hostname}. Supported: youtube.com, spotify.com`,
      });
      return;
    }

    const { tracks } = result as { tracks: unknown[] };
    res.json({ tracks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "URL resolution failed";
    res.status(helperErrorStatus(err)).json({ error: message });
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

router.delete("/yt/history", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;
  try {
    await db.delete(ytSearchHistoryTable).where(eq(ytSearchHistoryTable.userId, userId));
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to clear history";
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
