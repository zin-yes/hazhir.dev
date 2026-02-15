import "server-cli-only";

import Logger from "@/lib/logger";
import { jts } from "@/lib/utils";

import { MeditationRepository } from "./meditation.repository";
import type {
  MeditationListResult,
  SaveMeditationSessionParams,
} from "./meditation.types";

class MeditationService {
  constructor(
    private readonly repository: MeditationRepository = new MeditationRepository(),
    private readonly logger: Logger = new Logger("MeditationService"),
  ) {}

  public async list(params: {
    userId: string;
    limit?: number;
  }): Promise<MeditationListResult> {
    try {
      const result = await this.repository.listByUser(params);
      this.logger.debug(`list(${jts(params)}) -> ${jts(result)}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in list.";
      this.logger.error(`list(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }

  public async save(params: SaveMeditationSessionParams) {
    try {
      if (params.endedAt < params.startedAt) {
        throw new Error("End time cannot be before start time.");
      }

      const result = await this.repository.create(params);
      this.logger.debug(`save(${jts(params)}) -> ${jts(result)}`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error in save.";
      this.logger.error(`save(${jts(params)}): ${errorMessage}`);
      throw error;
    }
  }
}

export const meditationService = new MeditationService();
