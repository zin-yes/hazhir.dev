import "server-cli-only";

import { desc, eq } from "drizzle-orm";

import { database } from "@/database";
import Logger from "@/lib/logger";
import { jts } from "@/lib/utils";

import { meditationSessionSchema } from "./meditation.schema";
import type {
  MeditationListResult,
  SaveMeditationSessionParams,
} from "./meditation.types";

export class MeditationRepository {
  constructor(
    private readonly db: typeof database = database,
    private readonly logger: Logger = new Logger("MeditationRepository"),
  ) {}

  public async listByUser(params: {
    userId: string;
    limit?: number;
  }): Promise<MeditationListResult> {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      const limit = params.limit ?? 50;
      const rows = await this.db
        .select()
        .from(meditationSessionSchema)
        .where(eq(meditationSessionSchema.userId, params.userId))
        .orderBy(desc(meditationSessionSchema.endedAt))
        .limit(limit);

      const result: MeditationListResult = {
        sessions: rows.map((session) => ({
          ...session,
          startedAt: new Date(session.startedAt).toISOString(),
          endedAt: new Date(session.endedAt).toISOString(),
        })),
      };

      this.logger.debug(`listByUser(${jts(params)}) -> ${jts(result)}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown error in listByUser.";
      this.logger.error(`listByUser(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async create(params: SaveMeditationSessionParams): Promise<{ ok: true }> {
    try {
      if (!this.db) {
        throw new Error("Database is not available.");
      }

      await this.db.insert(meditationSessionSchema).values({
        userId: params.userId,
        startedAt: new Date(params.startedAt),
        endedAt: new Date(params.endedAt),
        durationSeconds: params.durationSeconds,
        preset: params.preset ?? null,
        inhaleSeconds: params.inhaleSeconds ?? null,
        holdSeconds: params.holdSeconds ?? null,
        exhaleSeconds: params.exhaleSeconds ?? null,
        switchSeconds: params.switchSeconds ?? null,
        targetMinutes: params.targetMinutes ?? null,
        roundCount: params.roundCount ?? null,
      });

      const result = { ok: true } as const;
      this.logger.debug(`create(${jts(params)}) -> ${jts(result)}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in create.";
      this.logger.error(`create(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }
}
