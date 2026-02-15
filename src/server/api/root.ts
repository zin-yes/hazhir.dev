import { featureRouter } from "@/server/features/root";

export const appRouter = featureRouter;

export type AppRouter = typeof appRouter;
