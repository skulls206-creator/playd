import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, usersTable, tracksTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { getPresignedPutUrl, deleteObject, streamObject } from "../lib/r2";

const router: IRouter = Router();

// ── GET /vault/key-salt ────────────────────────────────────────────────────
// Returns the per-user PBKDF2 salt. Generates and persists one on first call.
// The salt is NOT secret — it's just an entropy source for key derivation.
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

  // First vault use — generate a fresh 32-byte (256-bit) salt.
  const salt = randomBytes(32).toString("hex");
  await db.update(usersTable).set({ vaultKeySalt: salt }).where(eq(usersTable.id, userId));
  res.json({ salt });
});

// ── POST /vault/upload-url ─────────────────────────────────────────────────
// Creates a track row (source = 'vault', vaultStatus = 'uploading') and returns
// a presigned R2 PUT URL so the browser uploads the ciphertext directly to R2.
//
// Body: {
//   title, artist, album, year, genre, duration, trackNumber, fileName,
//   vaultEncryptedKey, vaultKeyIv, vaultDataIv,
//   blobSize, contentType
// }
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
  if (typeof blobSize !== "number" || blobSize <= 0) {
    res.status(400).json({ error: "blobSize must be a positive number" });
    return;
  }

  // Use a transaction so the track row is never left without a vaultObjectPath.
  // If the update fails the insert is rolled back — no orphan rows.
  const { trackId, objectKey, uploadUrl } = await db.transaction(async (tx) => {
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

    // Generate the presigned URL inside the transaction boundary so a signing
    // failure also rolls back the DB rows.
    const url = await getPresignedPutUrl(
      key,
      contentType ? String(contentType) : "application/octet-stream",
      3600
    );

    return { trackId: track.id, objectKey: key, uploadUrl: url };
  });

  res.status(201).json({ trackId, objectKey, uploadUrl });
});

// ── POST /vault/confirm/:trackId ───────────────────────────────────────────
// Called by the client after the presigned PUT to R2 succeeds.
// Flips vaultStatus from 'uploading' to 'ready'.
router.post("/vault/confirm/:trackId", requireAuth, async (req, res): Promise<void> => {
  const userId  = req.userId!;
  const trackId = parseInt(req.params.trackId, 10);
  if (!trackId || isNaN(trackId)) {
    res.status(400).json({ error: "Invalid trackId" });
    return;
  }

  const [track] = await db
    .update(tracksTable)
    .set({ vaultStatus: "ready", updatedAt: new Date() })
    .where(
      and(
        eq(tracksTable.id, trackId),
        eq(tracksTable.userId, userId),
        eq(tracksTable.source, "vault")
      )
    )
    .returning({ id: tracksTable.id, vaultStatus: tracksTable.vaultStatus });

  if (!track) {
    res.status(404).json({ error: "Vault track not found" });
    return;
  }

  res.json({ id: track.id, vaultStatus: track.vaultStatus });
});

// ── GET /vault/download/:trackId ───────────────────────────────────────────
// Verifies ownership, then streams the encrypted R2 blob to the client.
// No presigned download URL — the JWT must be validated before handing out bytes.
router.get("/vault/download/:trackId", requireAuth, async (req, res): Promise<void> => {
  const userId  = req.userId!;
  const trackId = parseInt(req.params.trackId, 10);
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
  // No caching — this is authenticated encrypted content.
  res.setHeader("Cache-Control", "no-store");

  // Pipe the R2 readable stream directly to the HTTP response.
  // @aws-sdk/client-s3 v3 returns a NodeJS.ReadableStream-compatible Body.
  const stream = r2Response.Body.transformToWebStream();
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: "Stream error" });
    else res.destroy();
  }
});

// ── DELETE /vault/:trackId ─────────────────────────────────────────────────
// Deletes the R2 object and the track row.
router.delete("/vault/:trackId", requireAuth, async (req, res): Promise<void> => {
  const userId  = req.userId!;
  const trackId = parseInt(req.params.trackId, 10);
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

  // Delete from R2 first; if this fails we still want to clean up the DB row.
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
