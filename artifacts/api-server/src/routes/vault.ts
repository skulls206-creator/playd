import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { eq, and, sql, or, lt } from "drizzle-orm";
import { db, usersTable, tracksTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { putObject, deleteObject, streamObject, headObject } from "../lib/r2";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Storage limits ──────────────────────────────────────────────────────────
const MAX_VAULT_FILE_BYTES = 200 * 1024 * 1024;
const MAX_VAULT_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;
const STALE_UPLOAD_MAX_AGE_MS = 2 * 60 * 60 * 1000;

// ── GET /vault/key-salt ────────────────────────────────────────────────────
router.get("/vault/key-salt", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const [user] = await db
    .select({ vaultKeySalt: usersTable.vaultKeySalt })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (user.vaultKeySalt) {
    res.json({ salt: user.vaultKeySalt });
    return;
  }

  const salt = randomBytes(32).toString("hex");
  await db.update(usersTable).set({ vaultKeySalt: salt }).where(eq(usersTable.id, userId));
  res.json({ salt });
});

// ── POST /vault/upload-url ─────────────────────────────────────────────────
// Creates the track metadata row and reserves quota. Returns only { trackId }.
// The client then PUTs the binary ciphertext to /vault/upload/:trackId, which
// routes through the API server so size enforcement happens server-side rather
// than relying on client-supplied Content-Length to a presigned PUT URL.
//
// Quota is serialized with a PostgreSQL advisory lock so concurrent requests
// from the same user queue up and cannot collectively exceed the per-user limit.
router.post("/vault/upload-url", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;
  const {
    title, artist, album, year, genre, duration, trackNumber, fileName,
    vaultEncryptedKey, vaultKeyIv, vaultDataIv,
    blobSize, contentType,
  } = req.body as Record<string, unknown>;

  if (!title || !fileName || !vaultEncryptedKey || !vaultKeyIv || !vaultDataIv) {
    res.status(400).json({ error: "Missing required vault upload fields" });
    return;
  }
  if (
    typeof blobSize !== "number" ||
    !Number.isFinite(blobSize) ||
    !Number.isInteger(blobSize) ||
    blobSize <= 0
  ) {
    res.status(400).json({ error: "blobSize must be a positive integer number of bytes" });
    return;
  }

  if (blobSize > MAX_VAULT_FILE_BYTES) {
    res.status(413).json({
      error: `File too large. Maximum allowed size is ${MAX_VAULT_FILE_BYTES / (1024 * 1024)} MB per file`,
    });
    return;
  }

  // Serialize quota check + insert per user via a PostgreSQL advisory lock.
  // The lock is held only for the brief duration of the transaction; it is
  // released automatically on commit or rollback.
  let trackId: number;

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${userId}::bigint)`);

      // Sum 'ready' + 'uploading' tracks — both statuses count against quota.
      const [quotaRow] = await tx
        .select({ total: sql<number>`coalesce(sum(${tracksTable.vaultBlobSize}), 0)` })
        .from(tracksTable)
        .where(
          and(
            eq(tracksTable.userId, userId),
            eq(tracksTable.source, "vault"),
            or(
              eq(tracksTable.vaultStatus, "ready"),
              eq(tracksTable.vaultStatus, "uploading")
            )
          )
        );

      const usedBytes = Number(quotaRow?.total ?? 0);
      if (usedBytes + blobSize > MAX_VAULT_QUOTA_BYTES) {
        const remainingMB = Math.max(0, MAX_VAULT_QUOTA_BYTES - usedBytes) / (1024 * 1024);
        const err = new Error(
          `Storage quota exceeded. You have approximately ${remainingMB.toFixed(0)} MB remaining of your ${MAX_VAULT_QUOTA_BYTES / (1024 * 1024 * 1024)} GB quota`
        );
        (err as NodeJS.ErrnoException).code = "QUOTA_EXCEEDED";
        throw err;
      }

      const [track] = await tx
        .insert(tracksTable)
        .values({
          userId,
          title:    String(title),
          artist:   artist   ? String(artist)   : "Unknown Artist",
          album:    album    ? String(album)    : "Unknown Album",
          year:     typeof year === "number"    ? year        : null,
          genre:    genre    ? String(genre)    : null,
          duration: typeof duration === "number" ? duration   : 0,
          trackNumber: typeof trackNumber === "number" ? trackNumber : null,
          fileName: String(fileName),
          folderPath: "",
          source:   "vault",
          vaultEncryptedKey: String(vaultEncryptedKey),
          vaultKeyIv:        String(vaultKeyIv),
          vaultDataIv:       String(vaultDataIv),
          vaultStatus:       "uploading",
          vaultBlobSize:     blobSize,
        })
        .returning({ id: tracksTable.id });

      const key = `vault/${userId}/${track.id}/${randomUUID()}`;

      await tx
        .update(tracksTable)
        .set({ vaultObjectPath: key })
        .where(and(eq(tracksTable.id, track.id), eq(tracksTable.userId, userId)));

      return { trackId: track.id };
    });

    trackId = result.trackId;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "QUOTA_EXCEEDED") {
      res.status(413).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  // Return only trackId; the client uploads binary to /vault/upload/:trackId.
  res.status(201).json({ trackId });
});

// ── PUT /vault/upload/:trackId ─────────────────────────────────────────────
// Accepts the raw encrypted binary from the client, enforces the size limit
// server-side via a streaming byte counter, then writes to R2 via PutObject.
// After upload, verifies the object via HeadObject (authoritative size check),
// then atomically re-checks quota and marks the track 'ready'.
//
// This server-proxied approach ensures size enforcement is fully server-side:
// no presigned URL is ever exposed to the client for direct-to-R2 writes.
//
// Headers required:
//   Content-Type:   application/octet-stream (or matching vault contentType)
//   Content-Length: must equal the declared blobSize
router.put("/vault/upload/:trackId", requireAuth, async (req, res): Promise<void> => {
  const userId  = req.userId!;
  const trackId = parseInt(req.params.trackId as string, 10);
  if (!trackId || isNaN(trackId)) {
    res.status(400).json({ error: "Invalid trackId" });
    return;
  }

  // Require Content-Length so we can reject oversize requests early.
  const contentLengthHeader = req.headers["content-length"];
  if (!contentLengthHeader) {
    res.status(411).json({ error: "Content-Length header is required" });
    return;
  }
  const contentLength = parseInt(contentLengthHeader, 10);
  if (isNaN(contentLength) || contentLength <= 0) {
    res.status(400).json({ error: "Content-Length must be a positive integer" });
    return;
  }
  if (contentLength > MAX_VAULT_FILE_BYTES) {
    res.status(413).json({ error: `Upload exceeds the maximum allowed file size of ${MAX_VAULT_FILE_BYTES / (1024 * 1024)} MB` });
    return;
  }

  const [track] = await db
    .select({
      id:              tracksTable.id,
      vaultObjectPath: tracksTable.vaultObjectPath,
      vaultBlobSize:   tracksTable.vaultBlobSize,
      vaultStatus:     tracksTable.vaultStatus,
      createdAt:       tracksTable.createdAt,
    })
    .from(tracksTable)
    .where(
      and(
        eq(tracksTable.id, trackId),
        eq(tracksTable.userId, userId),
        eq(tracksTable.source, "vault")
      )
    )
    .limit(1);

  if (!track) {
    res.status(404).json({ error: "Vault track not found" });
    return;
  }
  if (track.vaultStatus !== "uploading") {
    res.status(409).json({ error: "Track is not in uploading state" });
    return;
  }

  // Reject attempts to upload more bytes than declared at reservation time.
  const declaredSize = track.vaultBlobSize ?? -1;
  if (contentLength !== declaredSize) {
    res.status(400).json({
      error: `Content-Length (${contentLength}) does not match declared blobSize (${declaredSize})`,
    });
    return;
  }

  // Reject stale upload windows.
  const ageMs = Date.now() - (track.createdAt?.getTime() ?? 0);
  if (ageMs > STALE_UPLOAD_MAX_AGE_MS) {
    if (track.vaultObjectPath) {
      await deleteObject(track.vaultObjectPath).catch(() => {});
    }
    await db.delete(tracksTable).where(
      and(eq(tracksTable.id, track.id), eq(tracksTable.userId, userId))
    );
    res.status(410).json({ error: "Upload window has expired. Please start a new upload." });
    return;
  }

  if (!track.vaultObjectPath) {
    res.status(500).json({ error: "Vault object path missing" });
    return;
  }

  // Stream the request body to R2 through a byte-counting Transform that
  // aborts the upload if more bytes than declared actually arrive.
  let bytesReceived = 0;
  const sizeLimitStream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytesReceived += chunk.length;
      if (bytesReceived > declaredSize) {
        cb(new Error(`Upload exceeded declared size of ${declaredSize} bytes`));
      } else {
        cb(null, chunk);
      }
    },
  });

  try {
    await putObject(
      track.vaultObjectPath,
      req.headers["content-type"] ?? "application/octet-stream",
      declaredSize,
      req.pipe(sizeLimitStream)
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Upload to storage failed";
    // Best-effort cleanup of any partial object.
    await deleteObject(track.vaultObjectPath).catch(() => {});
    await db.delete(tracksTable).where(
      and(eq(tracksTable.id, track.id), eq(tracksTable.userId, userId))
    );
    res.status(422).json({ error: msg });
    return;
  }

  // Authoritative post-upload size verification via HeadObject.
  let storedSize: number;
  try {
    const r2Meta = await headObject(track.vaultObjectPath);
    storedSize = r2Meta.ContentLength ?? -1;
  } catch {
    await deleteObject(track.vaultObjectPath).catch(() => {});
    await db.delete(tracksTable).where(
      and(eq(tracksTable.id, track.id), eq(tracksTable.userId, userId))
    );
    res.status(502).json({ error: "Could not verify upload with storage provider" });
    return;
  }

  if (storedSize !== declaredSize) {
    await deleteObject(track.vaultObjectPath).catch(() => {});
    await db.delete(tracksTable).where(
      and(eq(tracksTable.id, track.id), eq(tracksTable.userId, userId))
    );
    res.status(422).json({
      error: `Upload size mismatch (declared ${declaredSize} B, stored ${storedSize} B). Upload rejected.`,
    });
    return;
  }

  // Atomically re-check quota and mark ready inside an advisory-locked transaction.
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${userId}::bigint)`);

      const [quotaRow] = await tx
        .select({ total: sql<number>`coalesce(sum(${tracksTable.vaultBlobSize}), 0)` })
        .from(tracksTable)
        .where(
          and(
            eq(tracksTable.userId, userId),
            eq(tracksTable.source, "vault"),
            eq(tracksTable.vaultStatus, "ready")
          )
        );

      const usedBytes = Number(quotaRow?.total ?? 0);
      if (usedBytes + declaredSize > MAX_VAULT_QUOTA_BYTES) {
        const remainingMB = Math.max(0, MAX_VAULT_QUOTA_BYTES - usedBytes) / (1024 * 1024);
        const err = new Error(
          `Storage quota exceeded at upload completion. You have approximately ${remainingMB.toFixed(0)} MB remaining.`
        );
        (err as NodeJS.ErrnoException).code = "QUOTA_EXCEEDED";
        throw err;
      }

      const [row] = await tx
        .update(tracksTable)
        .set({ vaultStatus: "ready", updatedAt: new Date() })
        .where(
          and(
            eq(tracksTable.id, trackId),
            eq(tracksTable.userId, userId),
            eq(tracksTable.source, "vault"),
            eq(tracksTable.vaultStatus, "uploading")
          )
        )
        .returning({ id: tracksTable.id, vaultStatus: tracksTable.vaultStatus });

      if (!row) {
        const err = new Error("CONCURRENT_MODIFICATION");
        (err as NodeJS.ErrnoException).code = "CONCURRENT_MODIFICATION";
        throw err;
      }
    });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "QUOTA_EXCEEDED") {
      await deleteObject(track.vaultObjectPath!).catch(() => {});
      await db.delete(tracksTable).where(
        and(eq(tracksTable.id, track.id), eq(tracksTable.userId, userId))
      );
      res.status(413).json({ error: (err as Error).message });
      return;
    }
    if (code === "CONCURRENT_MODIFICATION") {
      res.status(409).json({ error: "Could not finalize track — concurrent modification detected" });
      return;
    }
    throw err;
  }

  res.json({ id: trackId, vaultStatus: "ready" });
});

// ── POST /vault/confirm/:trackId ───────────────────────────────────────────
// Read-only status check: returns the current vaultStatus of a track owned by
// the requesting user. Idempotent and safe to poll after upload completion.
router.post("/vault/confirm/:trackId", requireAuth, async (req, res): Promise<void> => {
  const userId  = req.userId!;
  const trackId = parseInt(req.params.trackId as string, 10);
  if (!trackId || isNaN(trackId)) {
    res.status(400).json({ error: "Invalid trackId" });
    return;
  }

  const [track] = await db
    .select({ id: tracksTable.id, vaultStatus: tracksTable.vaultStatus })
    .from(tracksTable)
    .where(
      and(
        eq(tracksTable.id, trackId),
        eq(tracksTable.userId, userId),
        eq(tracksTable.source, "vault")
      )
    )
    .limit(1);

  if (!track) {
    res.status(404).json({ error: "Vault track not found" });
    return;
  }

  res.json({ id: track.id, vaultStatus: track.vaultStatus });
});

// ── GET /vault/download/:trackId ───────────────────────────────────────────
router.get("/vault/download/:trackId", requireAuth, async (req, res): Promise<void> => {
  const userId  = req.userId!;
  const trackId = parseInt(req.params.trackId as string, 10);
  if (!trackId || isNaN(trackId)) {
    res.status(400).json({ error: "Invalid trackId" });
    return;
  }

  const [track] = await db
    .select({
      vaultObjectPath: tracksTable.vaultObjectPath,
      vaultStatus:     tracksTable.vaultStatus,
    })
    .from(tracksTable)
    .where(
      and(
        eq(tracksTable.id, trackId),
        eq(tracksTable.userId, userId),
        eq(tracksTable.source, "vault")
      )
    )
    .limit(1);

  if (!track) {
    res.status(404).json({ error: "Vault track not found" });
    return;
  }
  if (track.vaultStatus !== "ready") {
    res.status(409).json({ error: "Vault track upload not yet confirmed" });
    return;
  }
  if (!track.vaultObjectPath) {
    res.status(500).json({ error: "Vault object path missing" });
    return;
  }

  const r2Response = await streamObject(track.vaultObjectPath);

  if (!r2Response.Body) {
    res.status(500).json({ error: "Empty response from storage" });
    return;
  }

  res.setHeader("Content-Type", r2Response.ContentType ?? "application/octet-stream");
  if (r2Response.ContentLength) {
    res.setHeader("Content-Length", String(r2Response.ContentLength));
  }
  res.setHeader("Cache-Control", "no-store");

  const stream = r2Response.Body.transformToWebStream();
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch {
    if (!res.headersSent) res.status(500).json({ error: "Stream error" });
    else res.destroy();
  }
});

// ── DELETE /vault/:trackId ─────────────────────────────────────────────────
router.delete("/vault/:trackId", requireAuth, async (req, res): Promise<void> => {
  const userId  = req.userId!;
  const trackId = parseInt(req.params.trackId as string, 10);
  if (!trackId || isNaN(trackId)) {
    res.status(400).json({ error: "Invalid trackId" });
    return;
  }

  const [track] = await db
    .select({ vaultObjectPath: tracksTable.vaultObjectPath })
    .from(tracksTable)
    .where(
      and(
        eq(tracksTable.id, trackId),
        eq(tracksTable.userId, userId),
        eq(tracksTable.source, "vault")
      )
    )
    .limit(1);

  if (!track) {
    res.status(404).json({ error: "Vault track not found" });
    return;
  }

  if (track.vaultObjectPath) {
    await deleteObject(track.vaultObjectPath).catch((err) => {
      console.warn("R2 delete failed (continuing with DB delete):", err);
    });
  }

  await db
    .delete(tracksTable)
    .where(and(eq(tracksTable.id, trackId), eq(tracksTable.userId, userId)));

  res.sendStatus(204);
});

export default router;

// ── Background stale-upload cleanup ────────────────────────────────────────

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Delete vault tracks globally stuck in 'uploading' status longer than
 * STALE_UPLOAD_MAX_AGE_MS. Removes both the R2 object and the DB row so
 * storage and quota are reclaimed for all users, independent of user activity.
 * This prevents abandoned uploads (including attacker-originated ones that
 * never call the upload or confirm endpoint) from persisting indefinitely.
 */
export async function pruneStaleVaultUploads(): Promise<void> {
  const staleThreshold = new Date(Date.now() - STALE_UPLOAD_MAX_AGE_MS);

  let staleRows: { id: number; vaultObjectPath: string | null }[];
  try {
    staleRows = await db
      .select({ id: tracksTable.id, vaultObjectPath: tracksTable.vaultObjectPath })
      .from(tracksTable)
      .where(
        and(
          eq(tracksTable.source, "vault"),
          eq(tracksTable.vaultStatus, "uploading"),
          lt(tracksTable.createdAt, staleThreshold)
        )
      );
  } catch (err) {
    logger.warn({ err }, "vault-cleanup: failed to query stale uploads");
    return;
  }

  if (staleRows.length === 0) return;

  logger.info({ count: staleRows.length }, "vault-cleanup: pruning stale uploads");

  for (const row of staleRows) {
    if (row.vaultObjectPath) {
      let r2Ok = true;
      await deleteObject(row.vaultObjectPath).catch((err) => {
        r2Ok = false;
        logger.warn({ err, key: row.vaultObjectPath }, "vault-cleanup: R2 delete failed; retaining DB row for next run");
      });
      if (!r2Ok) continue;
    }
    await db
      .delete(tracksTable)
      .where(eq(tracksTable.id, row.id))
      .catch((err) =>
        logger.warn({ err, id: row.id }, "vault-cleanup: DB delete failed")
      );
  }
}

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic stale-upload cleanup job. Safe to call multiple times.
 */
export function startVaultCleanup(): void {
  if (cleanupTimer) return;
  pruneStaleVaultUploads().catch(() => {});
  cleanupTimer = setInterval(() => {
    pruneStaleVaultUploads().catch(() => {});
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}
