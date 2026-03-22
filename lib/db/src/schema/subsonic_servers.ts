import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const subsonicServersTable = pgTable("subsonic_servers", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull(),
  url: text("url").notNull(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSubsonicServerSchema = createInsertSchema(subsonicServersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSubsonicServer = z.infer<typeof insertSubsonicServerSchema>;
export type SubsonicServer = typeof subsonicServersTable.$inferSelect;
