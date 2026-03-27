import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tracksTable = pgTable("tracks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  title: text("title").notNull(),
  artist: text("artist").notNull().default("Unknown Artist"),
  album: text("album").notNull().default("Unknown Album"),
  year: integer("year"),
  genre: text("genre"),
  duration: real("duration").notNull().default(0),
  trackNumber: integer("track_number"),
  fileName: text("file_name").notNull(),
  folderPath: text("folder_path").notNull().default(""),
  albumArtDataUrl: text("album_art_data_url"),
  rating: integer("rating").notNull().default(0),
  source: text("source").notNull().default("local"),
  subsonicId: text("subsonic_id"),
  subsonicServerId: integer("subsonic_server_id"),
  replaygainGain: real("replaygain_gain"),
  // ── Zero-knowledge vault fields ─────────────────────────────────────────────
  // Populated only when source = 'vault'. The server stores only opaque
  // ciphertext in R2; audio bytes are never seen in plaintext by the server.
  vaultObjectPath:   text("vault_object_path"),   // R2 object key for the encrypted blob
  vaultEncryptedKey: text("vault_encrypted_key"), // base64(AES-KW wrapped per-file key)
  vaultKeyIv:        text("vault_key_iv"),        // base64(IV used to wrap the file key)
  vaultDataIv:       text("vault_data_iv"),       // base64(IV used for AES-GCM file encryption)
  vaultStatus:       text("vault_status"),        // 'uploading' | 'ready' | null
  // ────────────────────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTrackSchema = createInsertSchema(tracksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrack = z.infer<typeof insertTrackSchema>;
export type Track = typeof tracksTable.$inferSelect;
