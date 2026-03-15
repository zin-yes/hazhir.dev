import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "@/database/schema";

export const session = sqliteTable("meditation_session", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  startedAt: integer("startedAt", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("endedAt", { mode: "timestamp_ms" }).notNull(),
  durationSeconds: integer("durationSeconds").notNull(),
  preset: text("preset"),
  inhaleSeconds: integer("inhaleSeconds"),
  holdSeconds: integer("holdSeconds"),
  exhaleSeconds: integer("exhaleSeconds"),
  switchSeconds: integer("switchSeconds"),
  targetMinutes: integer("targetMinutes"),
  roundCount: integer("roundCount"),
});
