import { NextResponse, type NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";

import { auth } from "@/auth";
import { database } from "@/database";
import { meditationSessions } from "@/database/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getUserId(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user?.id ?? null;
}

function ensureDatabase() {
  if (!database) {
    return NextResponse.json(
      { error: "Database is not available." },
      { status: 503 },
    );
  }
  return null;
}

export async function GET(request: NextRequest) {
  const dbError = ensureDatabase();
  if (dbError) return dbError;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessions = await database
    .select()
    .from(meditationSessions)
    .where(eq(meditationSessions.userId, userId))
    .orderBy(desc(meditationSessions.endedAt))
    .limit(50);

  return NextResponse.json({
    sessions: sessions.map((session) => ({
      ...session,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: new Date(session.endedAt).toISOString(),
    })),
  });
}

export async function POST(request: NextRequest) {
  const dbError = ensureDatabase();
  if (dbError) return dbError;

  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    startedAt?: number;
    endedAt?: number;
    durationSeconds?: number;
    preset?: string | null;
    inhaleSeconds?: number | null;
    holdSeconds?: number | null;
    exhaleSeconds?: number | null;
    switchSeconds?: number | null;
    targetMinutes?: number | null;
    roundCount?: number | null;
  };

  const startedAt = Number(body.startedAt);
  const endedAt = Number(body.endedAt);
  const durationSeconds = Number(body.durationSeconds);

  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) {
    return NextResponse.json({ error: "Invalid timestamps." }, { status: 400 });
  }

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return NextResponse.json(
      { error: "Invalid duration." },
      { status: 400 },
    );
  }

  if (endedAt < startedAt) {
    return NextResponse.json(
      { error: "End time cannot be before start time." },
      { status: 400 },
    );
  }

  const id = crypto.randomUUID();

  await database.insert(meditationSessions).values({
    id,
    userId,
    startedAt,
    endedAt,
    durationSeconds,
    preset: body.preset ?? null,
    inhaleSeconds: body.inhaleSeconds ?? null,
    holdSeconds: body.holdSeconds ?? null,
    exhaleSeconds: body.exhaleSeconds ?? null,
    switchSeconds: body.switchSeconds ?? null,
    targetMinutes: body.targetMinutes ?? null,
    roundCount: body.roundCount ?? null,
  });

  return NextResponse.json({ ok: true, id });
}
