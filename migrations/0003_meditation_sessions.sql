CREATE TABLE "meditation_session" (
  "id" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "startedAt" integer NOT NULL,
  "endedAt" integer NOT NULL,
  "durationSeconds" integer NOT NULL,
  "preset" text,
  "inhaleSeconds" integer,
  "holdSeconds" integer,
  "exhaleSeconds" integer,
  "switchSeconds" integer,
  "targetMinutes" integer,
  "roundCount" integer
);

CREATE INDEX "meditation_session_user_id_idx" ON "meditation_session" ("userId");
CREATE INDEX "meditation_session_ended_at_idx" ON "meditation_session" ("endedAt");
