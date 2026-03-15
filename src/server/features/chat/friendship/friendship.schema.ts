import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "@/database/schema";

export const friendship = sqliteTable("friendship", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  friendId: text("friendId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
});
