import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const ytSearchHistoryTable = pgTable("yt_search_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  query: text("query").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type YtSearchHistory = typeof ytSearchHistoryTable.$inferSelect;
