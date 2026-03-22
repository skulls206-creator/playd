import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const queuedTracksTable = pgTable("queued_tracks", {
  id: serial("id").primaryKey(),
  trackId: integer("track_id").notNull(),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertQueuedTrackSchema = createInsertSchema(queuedTracksTable).omit({ id: true, createdAt: true });
export type InsertQueuedTrack = z.infer<typeof insertQueuedTrackSchema>;
export type QueuedTrack = typeof queuedTracksTable.$inferSelect;
