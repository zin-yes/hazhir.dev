CREATE TABLE "friendship" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "friendId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "status" text NOT NULL DEFAULT 'pending',
  "createdAt" integer NOT NULL
);

CREATE INDEX "friendship_user_id_idx" ON "friendship" ("userId");
CREATE INDEX "friendship_friend_id_idx" ON "friendship" ("friendId");

CREATE TABLE "chat_message" (
  "id" text PRIMARY KEY NOT NULL,
  "senderId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "recipientId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "content" text NOT NULL,
  "createdAt" integer NOT NULL
);

CREATE INDEX "chat_message_sender_id_idx" ON "chat_message" ("senderId");
CREATE INDEX "chat_message_recipient_id_idx" ON "chat_message" ("recipientId");
