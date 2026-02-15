import { createTRPCRouter } from "@/server/features/trpc";

import { meditationRouter } from "./meditation/meditation.router";

export const featureRouter = createTRPCRouter({
  meditation: meditationRouter,
});
