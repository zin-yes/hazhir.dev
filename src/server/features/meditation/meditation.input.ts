import { z } from "zod";

export const listMeditationSessionsValidator = z
  .object({
    limit: z.number().int().positive().max(100).optional(),
  })
  .optional();

export const saveMeditationSessionValidator = z.object({
  startedAt: z.number().int(),
  endedAt: z.number().int(),
  durationSeconds: z.number().int().positive(),
  preset: z.string().nullable().optional(),
  inhaleSeconds: z.number().int().nullable().optional(),
  holdSeconds: z.number().int().nullable().optional(),
  exhaleSeconds: z.number().int().nullable().optional(),
  switchSeconds: z.number().int().nullable().optional(),
  targetMinutes: z.number().int().nullable().optional(),
  roundCount: z.number().int().nullable().optional(),
});

export type ListMeditationSessionsInput = z.infer<
  typeof listMeditationSessionsValidator
>;
export type SaveMeditationSessionInput = z.infer<
  typeof saveMeditationSessionValidator
>;
