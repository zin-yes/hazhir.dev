import "server-cli-only";

import { TRPCError } from "@trpc/server";

import { createTRPCRouter, protectedProcedure } from "@/server/features/trpc";

import {
  listMeditationSessionsValidator,
  saveMeditationSessionValidator,
} from "./meditation.input";
import { meditationService } from "./meditation.service";

export const meditationRouter = createTRPCRouter({
  list: protectedProcedure
    .input(listMeditationSessionsValidator)
    .query(async ({ ctx, input }) => {
      const result = await meditationService.list({
        userId: ctx.userId,
        limit: input?.limit,
      });

      return result;
    }),
  save: protectedProcedure
    .input(saveMeditationSessionValidator)
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await meditationService.save({
          userId: ctx.userId,
          ...input,
        });

        return result;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unable to save session.";

        if (errorMessage === "End time cannot be before start time.") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: errorMessage,
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: errorMessage,
        });
      }
    }),
});
