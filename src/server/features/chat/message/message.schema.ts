import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { user } from "@/database/schema";

export const message = sqliteTable("chat_message", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  senderId: text("senderId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  recipientId: text("recipientId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
});
