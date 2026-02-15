import { initTRPC, TRPCError } from "@trpc/server";

import { auth } from "@/auth";
import { database } from "@/database";

export type TrpcContext = {
  userId: string | null;
  headers: Headers;
  database: typeof database;
};

export async function createContext({ req }: { req: Request }) {
  const session = await auth.api.getSession({ headers: req.headers });
  return {
    userId: session?.user?.id ?? null,
    headers: req.headers,
    database,
  } satisfies TrpcContext;
}

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

const enforceUser = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,
    },
  });
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(enforceUser);
