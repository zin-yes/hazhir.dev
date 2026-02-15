import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "@/server/api/root";
import { createContext } from "@/server/api/trpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext({ req }),
  });

export { handler as GET, handler as POST };
