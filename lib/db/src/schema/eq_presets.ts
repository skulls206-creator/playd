import { pgTable, text, serial, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const eqPresetsTable = pgTable("eq_presets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  bands: text("bands").notNull().default("[]"),
  isActive: boolean("is_active").notNull().default(false),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEqPresetSchema = createInsertSchema(eqPresetsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEqPreset = z.infer<typeof insertEqPresetSchema>;
export type EqPreset = typeof eqPresetsTable.$inferSelect;
