import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const testTable = sqliteTable("test", {
  id: integer("id").primaryKey(),
  name: text("content").notNull(),
  createdAt: text("created_at")
    .default(sql`(CURRENT_TIMESTAMP)`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$onUpdate(
    () => new Date(),
  ),
});

export type InsertTest = typeof testTable.$inferInsert;
export type SelectTest = typeof testTable.$inferSelect;
