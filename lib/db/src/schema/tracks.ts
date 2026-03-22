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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTrackSchema = createInsertSchema(tracksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTrack = z.infer<typeof insertTrackSchema>;
export type Track = typeof tracksTable.$inferSelect;
