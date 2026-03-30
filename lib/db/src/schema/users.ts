import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique(),
  email: text("email").unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Zero-knowledge vault: PBKDF2 salt stored server-side (not secret).
  // The client uses this salt + the user's password to derive the vault master key.
  vaultKeySalt: text("vault_key_salt"),
});

export type User = typeof usersTable.$inferSelect;
