import { createTRPCRouter } from "@/server/features/trpc";

import { chatRouter } from "./chat/chat.router";
import { meditationRouter } from "./meditation/meditation.router";

export const featureRouter = createTRPCRouter({
  chat: chatRouter,
  meditation: meditationRouter,
});
